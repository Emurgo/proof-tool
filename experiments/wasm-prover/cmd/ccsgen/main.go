package main

import (
	"flag"
	"fmt"
	"os"

	"proof-tool/internal/prover"
)

func main() {
	outPath := flag.String("out", "", "constraint-system output path")
	flag.Parse()
	if *outPath == "" {
		fmt.Fprintln(os.Stderr, "usage: ccsgen --out ownership-destination.ccs")
		os.Exit(2)
	}

	ccs, err := prover.CompileOwnershipDestination()
	if err != nil {
		fmt.Fprintf(os.Stderr, "compile destination circuit: %v\n", err)
		os.Exit(1)
	}
	f, err := os.Create(*outPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "create %s: %v\n", *outPath, err)
		os.Exit(1)
	}
	if _, err := ccs.WriteTo(f); err != nil {
		f.Close()
		fmt.Fprintf(os.Stderr, "write ccs: %v\n", err)
		os.Exit(1)
	}
	if err := f.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "close %s: %v\n", *outPath, err)
		os.Exit(1)
	}

	digest, err := prover.DigestFile(*outPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "digest ccs: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("wrote %s\n", *outPath)
	fmt.Printf("constraints=%d\n", ccs.GetNbConstraints())
	fmt.Printf("internal_variables=%d\n", ccs.GetNbInternalVariables())
	fmt.Printf("secret_variables=%d\n", ccs.GetNbSecretVariables())
	fmt.Printf("public_variables=%d\n", ccs.GetNbPublicVariables())
	fmt.Printf("sha256=%s\n", digest.SHA256)
	fmt.Printf("blake2b256=%s\n", digest.Blake2b256)
	fmt.Printf("size=%d\n", digest.Size)
}
