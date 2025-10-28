package main

import (
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func getConfigPath() string {
	p := os.Getenv("CONFIG_PATH")
	if p == "" {
		return "/etc/alert-example/config.yaml"
	}
	return p
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func handleConfig(w http.ResponseWriter, r *http.Request) {
	path := getConfigPath()
	data, err := ioutil.ReadFile(path)
	if err != nil {
		log.Printf("ERROR: failed to read config file %s: %v", path, err)
		http.Error(w, "failed to read config", http.StatusInternalServerError)
		return
	}

	content := string(data)
	if strings.Contains(content, "Crash") {
		log.Printf("ERROR: config contained Crash keyword, terminating")
		go func() {
			time.Sleep(500 * time.Millisecond)
			os.Exit(1)
		}()
		http.Error(w, "config triggered crash", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func main() {
	// Startup check: read config and terminate immediately if it contains "Crash"
	if data, err := ioutil.ReadFile(getConfigPath()); err == nil {
		if strings.Contains(string(data), "Crash") {
			log.Printf("ERROR: config contained Crash keyword on startup, terminating")
			os.Exit(1)
		} else {
			log.Printf("INFO: data from config file: %s", string(data))
		}
	} else {
		log.Printf("WARN: could not read config on startup: %v", err)
		os.Exit(1)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", handleHealthz)
	mux.HandleFunc("/config", handleConfig)

	addr := ":8080"
	if v := os.Getenv("PORT"); v != "" {
		addr = ":" + v
	}

	log.Printf("alert-example starting on %s, CONFIG_PATH=%s", addr, getConfigPath())
	srv := &http.Server{Addr: addr, Handler: mux}
	if err := srv.ListenAndServe(); err != nil {
		log.Printf("server exited: %v", err)
	}
}
