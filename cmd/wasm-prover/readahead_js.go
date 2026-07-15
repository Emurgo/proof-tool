//go:build js && wasm

package main

import (
	"net/url"
	"sort"
	"strings"
	"syscall/js"

	"proof-tool/internal/msmengine"
)

// chunkReadahead warms the browser HTTP cache with the proving-key chunks in
// section-dispatch order while the head of the proof (open-ccs, find-path,
// witness, solve) runs and the downlink would otherwise sit idle. The MSM
// workers later fetch the same URLs with cache:'force-cache', so every warmed
// chunk is served from the local cache instead of the network. Warming is a
// plain low-priority fetch that discards the body — integrity is still
// enforced by the workers' digest checks at consumption time, so the
// readahead adds no new trust surface.
//
// The JS loop lives in prover-worker.js (__proofChunkReadahead); when the
// hosting page runs an older worker script the global is absent and the
// readahead silently degrades to today's behavior.

// readaheadSectionRank orders sections by when the prover first consumes
// them: commitment Basis MSMs run inside the solver hint, BasisExpSigma /
// G2B / A / B / K are dispatched right after solve (W1), and Z is consumed
// last because it waits on computeH.
func readaheadSectionRank(name string) int {
	switch {
	case name == "G2B":
		return 3
	case name == "A":
		return 4
	case name == "B":
		return 5
	case name == "K":
		return 6
	case name == "Z":
		return 7
	case strings.HasPrefix(name, "BasisExpSigma"):
		return 2
	case strings.HasPrefix(name, "Basis"):
		return 1
	default:
		return 8
	}
}

// readaheadChunkURLs returns every chunk URL of the plan exactly once,
// ordered by the dispatch rank of the first section that needs the chunk.
func readaheadChunkURLs(plan *msmengine.PKSectionPlan) []string {
	if plan == nil || plan.BaseURL == "" || len(plan.Chunks) == 0 {
		return nil
	}
	base, err := url.Parse(plan.BaseURL)
	if err != nil {
		return nil
	}

	names := make([]string, 0, len(plan.Sections))
	for name := range plan.Sections {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		ri, rj := readaheadSectionRank(names[i]), readaheadSectionRank(names[j])
		if ri != rj {
			return ri < rj
		}
		return plan.Sections[names[i]].Offset < plan.Sections[names[j]].Offset
	})

	seen := make([]bool, len(plan.Chunks))
	urls := make([]string, 0, len(plan.Chunks))
	appendRange := func(start, end int64) {
		for i, chunk := range plan.Chunks {
			if seen[i] || chunk.Offset+chunk.Size <= start || chunk.Offset >= end {
				continue
			}
			ref, err := url.Parse(chunk.Path)
			if err != nil {
				continue
			}
			seen[i] = true
			urls = append(urls, base.ResolveReference(ref).String())
		}
	}
	for _, name := range names {
		sec := plan.Sections[name]
		appendRange(sec.Offset, sec.Offset+sec.Len)
	}
	// Cover any chunks outside every section (headers, padding) last.
	appendRange(0, int64(1)<<62)
	return urls
}

// startChunkReadahead kicks off the background warm-up and returns a cancel
// function. concurrency is clamped to 1..4; the caller gates on > 0.
func startChunkReadahead(plan *msmengine.PKSectionPlan, concurrency int) (cancel func(), chunkCount int) {
	hook := js.Global().Get("__proofChunkReadahead")
	if hook.Type() != js.TypeFunction {
		return nil, 0
	}
	urls := readaheadChunkURLs(plan)
	if len(urls) == 0 {
		return nil, 0
	}
	if concurrency < 1 {
		concurrency = 1
	} else if concurrency > 4 {
		concurrency = 4
	}
	arr := js.Global().Get("Array").New(len(urls))
	for i, u := range urls {
		arr.SetIndex(i, u)
	}
	handle := hook.Invoke(arr, concurrency)
	return func() {
		if handle.Type() == js.TypeObject {
			cancelFn := handle.Get("cancel")
			if cancelFn.Type() == js.TypeFunction {
				cancelFn.Invoke()
			}
		}
	}, len(urls)
}
