{-# LANGUAGE DataKinds #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Ownership.ParamsHolder
  ( paramsHolderValidatorCode
  , paramsHolderValidatorUntyped
  ) where

import PlutusTx (CompiledCode)
import qualified PlutusTx
import PlutusTx.Prelude

{-# INLINABLE paramsHolderValidatorUntyped #-}
paramsHolderValidatorUntyped :: BuiltinData -> BuiltinUnit
paramsHolderValidatorUntyped _ =
  traceError "reclaim params holder is immutable"

paramsHolderValidatorCode :: CompiledCode (BuiltinData -> BuiltinUnit)
paramsHolderValidatorCode =
  $$(PlutusTx.compile [||paramsHolderValidatorUntyped||])
