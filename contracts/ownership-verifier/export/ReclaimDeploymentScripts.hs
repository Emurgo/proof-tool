{-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import Control.Monad (unless)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Short as SBS
import Data.Char (digitToInt, intToDigit, isHexDigit, toLower)
import Data.List (intercalate)
import Numeric.Natural (Natural)
import System.Environment (getArgs)
import System.Exit (die)
import Text.Printf (printf)
import Data.Word (Word8)

import qualified PlutusLedgerApi.V3 as V3
import PlutusTx (CompiledCode)
import qualified PlutusTx
import qualified PlutusTx.Builtins as B
import PlutusTx.Builtins (BuiltinByteString)

import Ownership.OneShotNFT (oneShotNFTPolicyCode)
import Ownership.ParamsHolder (paramsHolderValidatorCode)
import Ownership.ReclaimBase (reclaimBaseValidatorCode)
import Ownership.ReclaimGlobal (reclaimGlobalValidatorCode)

main :: IO ()
main = do
  args <- getArgs
  case args of
    ["one-shot", seedTxHashHex, seedOutputIndexRaw] -> do
      seedTxHash <- expectHexBytes "seed tx hash" 32 seedTxHashHex
      seedOutputIndex <- parseNatural "seed output index" seedOutputIndexRaw
      let seedRef = V3.TxOutRef (V3.TxId (bytesToBuiltin seedTxHash)) (toInteger seedOutputIndex)
          script =
            oneShotNFTPolicyCode
              `PlutusTx.unsafeApplyCode` PlutusTx.liftCodeDef seedRef
      printScript "one-shot-params-nft" script
    ["global", paramsPolicyIdHex, verifierKeyHex] -> do
      paramsPolicyId <- expectHexBytes "params policy id" 28 paramsPolicyIdHex
      verifierKey <- expectHexBytes "verifier key" 672 verifierKeyHex
      let script =
            reclaimGlobalValidatorCode
              `PlutusTx.unsafeApplyCode` PlutusTx.liftCodeDef (V3.CurrencySymbol (bytesToBuiltin paramsPolicyId))
              `PlutusTx.unsafeApplyCode` PlutusTx.liftCodeDef (bytesToBuiltin verifierKey)
      printScript "reclaim-global" script
    ["base", globalScriptHashHex] -> do
      globalScriptHash <- expectHexBytes "global script hash" 28 globalScriptHashHex
      let script =
            reclaimBaseValidatorCode
              `PlutusTx.unsafeApplyCode` PlutusTx.liftCodeDef (V3.ScriptCredential (V3.ScriptHash (bytesToBuiltin globalScriptHash)))
      printScript "reclaim-base" script
    ["params-holder"] ->
      printScript "reclaim-params-holder" paramsHolderValidatorCode
    _ ->
      die $
        "usage: reclaim-scripts-export one-shot <seed-tx-hash-hex> <seed-output-index>\n"
          <> "   or: reclaim-scripts-export global <params-policy-id-hex> <672-byte-cardano-verifier-key-hex>\n"
          <> "   or: reclaim-scripts-export base <global-script-hash-hex>\n"
          <> "   or: reclaim-scripts-export params-holder"

printScript :: String -> CompiledCode a -> IO ()
printScript name code =
  printf
    "{\n  \"schema\": \"proof-tool-reclaim-script-export-v1\",\n  \"name\": \"%s\",\n  \"type\": \"PlutusV3\",\n  \"script\": \"%s\"\n}\n"
    name
    (shortByteStringHex (V3.serialiseCompiledCode code))

expectHexBytes :: String -> Int -> String -> IO [Integer]
expectHexBytes label expected input = do
  bytes <- parseHex label input
  unless (length bytes == expected) $
    die (label <> " must be " <> show expected <> " bytes, got " <> show (length bytes))
  pure bytes

parseHex :: String -> String -> IO [Integer]
parseHex label input = do
  let cleaned = fmap toLower (filter (not . (`elem` ("_ \n\r\t" :: String))) input)
  unless (all isHexDigit cleaned) $
    die (label <> " must be lowercase hex")
  unless (even (length cleaned)) $
    die (label <> " hex must contain an even number of digits")
  pure (decodeHex cleaned)

decodeHex :: String -> [Integer]
decodeHex (hi : lo : rest) =
  fromIntegral (digitToInt hi * 16 + digitToInt lo) : decodeHex rest
decodeHex [] = []
decodeHex [_] = error "unreachable odd hex"

parseNatural :: String -> String -> IO Natural
parseNatural label input =
  case reads input of
    [(value, "")] | value >= (0 :: Integer) -> pure (fromInteger value)
    _ -> die (label <> " must be a non-negative integer")

bytesToBuiltin :: [Integer] -> BuiltinByteString
bytesToBuiltin = foldr B.consByteString B.emptyByteString

shortByteStringHex :: SBS.ShortByteString -> String
shortByteStringHex =
  byteStringHex . SBS.fromShort

byteStringHex :: BS.ByteString -> String
byteStringHex bytes =
  intercalate "" (fmap byteHex (BS.unpack bytes))

byteHex :: Word8 -> String
byteHex byte =
  [intToDigit (fromIntegral byte `div` 16), intToDigit (fromIntegral byte `mod` 16)]
