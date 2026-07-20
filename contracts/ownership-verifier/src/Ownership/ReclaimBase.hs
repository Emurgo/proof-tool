{-# LANGUAGE DataKinds #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE ViewPatterns #-}

module Ownership.ReclaimBase
  ( ReclaimBaseDatum (..)
  , reclaimBaseValidatorBuiltin
  , reclaimBaseValidatorCode
  , txInfoWdrlFieldIndex
  , txInfoWdrlFromContextData
  ) where

import PlutusTx (CompiledCode)
import qualified PlutusTx
import qualified PlutusTx.Builtins as B
import qualified PlutusTx.Builtins.Internal as BI
import PlutusTx.Prelude

data ReclaimBaseDatum = ReclaimBaseDatum
  { reclaimPaymentKeyHash :: BuiltinByteString
  }

PlutusTx.makeIsDataIndexed ''ReclaimBaseDatum [('ReclaimBaseDatum, 0)]
PlutusTx.makeLift ''ReclaimBaseDatum

-- | Zero-based field position in the Plutus V3 'TxInfo' Data constructor.
-- Verified against plutus-ledger-api-1.38.0.0
-- PlutusLedgerApi/V3/Data/Contexts.hs:498-524: txInfoWdrl is the seventh
-- declared field (after inputs, reference inputs, outputs, fee, mint, certs).
txInfoWdrlFieldIndex :: Integer
txInfoWdrlFieldIndex = 6

{-# INLINABLE builtinIf #-}
builtinIf :: BI.BuiltinBool -> a -> a -> a
builtinIf condition trueBranch falseBranch =
  BI.ifThenElse condition (\_ -> trueBranch) (\_ -> falseBranch) BI.unitval

{-# INLINABLE builtinAnd #-}
builtinAnd :: BI.BuiltinBool -> BI.BuiltinBool -> BI.BuiltinBool
builtinAnd left right = builtinIf left right BI.false

{-# INLINABLE builtinToBool #-}
builtinToBool :: BI.BuiltinBool -> Bool
builtinToBool condition = builtinIf condition True False

{-# INLINABLE field0 #-}
field0 :: BI.BuiltinList BuiltinData -> BuiltinData
field0 = BI.head

{-# INLINABLE findDataAt #-}
findDataAt :: Integer -> BI.BuiltinList BuiltinData -> BuiltinData
findDataAt index values =
  B.caseList
    (\() -> traceError "invalid script context layout")
    ( \value rest ->
        builtinIf
          (BI.equalsInteger index 0)
          value
          (findDataAt (index - 1) rest)
    )
    values

-- | Extract the withdrawal map from a library-encoded V3 ScriptContext.
-- Keeping this walk shared by the validator and the layout test makes a
-- plutus-ledger-api field-order change fail loudly in the test suite.
{-# INLINABLE txInfoWdrlFromContextData #-}
txInfoWdrlFromContextData :: BuiltinData -> BuiltinData
txInfoWdrlFromContextData ctx =
  let ctxConstr = BI.unsafeDataAsConstr ctx
      txInfo = field0 (BI.snd ctxConstr)
      txInfoConstr = BI.unsafeDataAsConstr txInfo
   in builtinIf
        (BI.equalsInteger (BI.fst ctxConstr) 0 `builtinAnd` BI.equalsInteger (BI.fst txInfoConstr) 0)
        (findDataAt txInfoWdrlFieldIndex (BI.snd txInfoConstr))
        (traceError "invalid script context layout")

{-# INLINABLE withdrawalKeyPresent #-}
withdrawalKeyPresent :: BuiltinData -> BI.BuiltinList (BI.BuiltinPair BuiltinData BuiltinData) -> BI.BuiltinBool
withdrawalKeyPresent expectedKey entries =
  B.caseList
    (\() -> BI.false)
    ( \entry rest ->
        builtinIf
          (BI.equalsData expectedKey (BI.fst entry))
          BI.true
          (withdrawalKeyPresent expectedKey rest)
    )
    entries

-- | Minimal production gate. The configured withdrawal key is applied at the
-- deployment boundary. For the audited script-credential deployment, its
-- presence causes the ledger to execute the corresponding global rewarding
-- validator. Purpose, datum, credential-width,
-- proof, destination, and value checks belong to the ledger invocation and the
-- global validator; duplicating them here adds cost without strengthening the
-- composed authorization property.
{-# INLINABLE reclaimBaseValidatorBuiltin #-}
reclaimBaseValidatorBuiltin :: BuiltinData -> BuiltinData -> BI.BuiltinBool
reclaimBaseValidatorBuiltin globalCredentialData ctx =
  withdrawalKeyPresent
    globalCredentialData
    (BI.unsafeDataAsMap (txInfoWdrlFromContextData ctx))

{-# INLINABLE reclaimBaseValidatorDataUntyped #-}
reclaimBaseValidatorDataUntyped :: BuiltinData -> BuiltinData -> BuiltinUnit
reclaimBaseValidatorDataUntyped globalCredentialData ctx =
  check $ builtinToBool $ reclaimBaseValidatorBuiltin globalCredentialData ctx

-- The deployment/export boundary applies the already encoded credential Data
-- to this code, so withdrawal-key Data is a compiled constant rather than
-- re-encoded for every validation.
reclaimBaseValidatorCode :: CompiledCode (BuiltinData -> BuiltinData -> BuiltinUnit)
reclaimBaseValidatorCode =
  $$(PlutusTx.compile [||reclaimBaseValidatorDataUntyped||])
