package main

import (
	"flag"
	"fmt"
	"os"
	"sort"

	"proof-tool/internal/streampk"
)

func main() {
	pkPath := flag.String("pk", "", "proving key path")
	outPath := flag.String("out", "", "index JSON output path")
	flag.Parse()
	if *pkPath == "" || *outPath == "" {
		fmt.Fprintln(os.Stderr, "usage: pkindex --pk ownership.pk --out ownership.pk.idx.json")
		os.Exit(2)
	}
	idx, err := streampk.BuildIndex(*pkPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "build index: %v\n", err)
		os.Exit(1)
	}
	if err := streampk.WriteIndex(*outPath, idx); err != nil {
		fmt.Fprintf(os.Stderr, "write index: %v\n", err)
		os.Exit(1)
	}
	names := make([]string, 0, len(idx.Sections))
	for name := range idx.Sections {
		names = append(names, name)
	}
	sort.Strings(names)
	fmt.Printf("wrote %s (%d sections, file_size=%d)\n", *outPath, len(names), idx.FileSize)
	for _, name := range names {
		sec := idx.Sections[name]
		fmt.Printf("%s offset=%d len=%d elem=%d\n", name, sec.Offset, sec.Len, sec.ElemSize)
	}
}
