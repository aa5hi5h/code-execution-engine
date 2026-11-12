FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip git curl nano procps ca-certificates \
      g++ make \
      default-jdk-headless \
      golang-go \
    && rm -rf /var/lib/apt/lists/*
# Warm the Go build cache so the first `go run` is fast
RUN mkdir /tmp/w && cd /tmp/w && printf 'package main\nimport "fmt"\nfunc main(){fmt.Println("ok")}\n' > a.go && go run a.go && rm -rf /tmp/w
WORKDIR /workspace
