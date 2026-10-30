// AOS2 test fixture: a local HTTP service with side effects.
//
// It exists so the effects ledger has something real to observe. Endpoints:
//
//	POST /charge   {"amount":N}  -> {"ok":true,"id":"ch-…"}; slow if ?delay=2s
//	POST /refund   {"id":"ch-…"} -> {"ok":true}
//	POST /lookup   {"id":"ch-…"} -> {"ok":true,"charged":true|false}
//	POST /send     {"to":"…"}    -> {"ok":true}  (irreversible: nothing undoes it)
//	GET  /state                  -> {"charged":N,"refunded":N,"sent":N}
//
// The point is idempotence checking: /charge with the same "idem" key returns
// the original id and does not increment the counter again. That is what lets a
// caller tell "my charge went through, the reply was lost" from "it never ran".
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

type state struct {
	mu       sync.Mutex
	charged  int
	refunded int
	sent     int
	byIdem   map[string]string // idem key -> charge id
	byID     map[string]bool   // charge id -> still charged
	seq      int
}

func main() {
	addr := flag.String("addr", "127.0.0.1:18080", "listen address")
	flag.Parse()

	st := &state{byIdem: map[string]string{}, byID: map[string]bool{}}

	http.HandleFunc("/charge", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Amount int    `json:"amount"`
			Idem   string `json:"idem"`
		}
		decode(w, r, &req)
		if d := r.URL.Query().Get("delay"); d != "" {
			if dur, err := time.ParseDuration(d); err == nil {
				time.Sleep(dur)
			}
		}
		st.mu.Lock()
		defer st.mu.Unlock()
		if id, ok := st.byIdem[req.Idem]; ok && req.Idem != "" {
			write(w, map[string]any{"ok": true, "id": id, "replayed": true})
			return
		}
		st.seq++
		id := fmt.Sprintf("ch-%04d", st.seq)
		st.charged++
		st.byID[id] = true
		if req.Idem != "" {
			st.byIdem[req.Idem] = id
		}
		write(w, map[string]any{"ok": true, "id": id})
	})

	http.HandleFunc("/refund", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID string `json:"id"`
		}
		decode(w, r, &req)
		st.mu.Lock()
		defer st.mu.Unlock()
		if ok := st.byID[req.ID]; !ok {
			write(w, map[string]any{"ok": false, "error": "unknown or already refunded"})
			return
		}
		st.byID[req.ID] = false
		st.refunded++
		write(w, map[string]any{"ok": true})
	})

	http.HandleFunc("/lookup", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID string `json:"id"`
		}
		decode(w, r, &req)
		st.mu.Lock()
		defer st.mu.Unlock()
		write(w, map[string]any{"ok": true, "charged": st.byID[req.ID]})
	})

	http.HandleFunc("/send", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			To   string `json:"to"`
			Idem string `json:"idem"`
		}
		decode(w, r, &req)
		st.mu.Lock()
		defer st.mu.Unlock()
		if _, ok := st.byIdem["send:"+req.Idem]; ok && req.Idem != "" {
			write(w, map[string]any{"ok": true, "replayed": true})
			return
		}
		st.sent++
		if req.Idem != "" {
			st.byIdem["send:"+req.Idem] = "sent"
		}
		write(w, map[string]any{"ok": true})
	})

	http.HandleFunc("/state", func(w http.ResponseWriter, r *http.Request) {
		st.mu.Lock()
		defer st.mu.Unlock()
		write(w, map[string]any{
			"charged":  st.charged,
			"refunded": st.refunded,
			"sent":     st.sent,
		})
	})

	log.Printf("fake-api listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}

func decode(w http.ResponseWriter, r *http.Request, v any) {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		http.Error(w, `{"ok":false,"error":"bad json"}`, http.StatusBadRequest)
	}
}

func write(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
