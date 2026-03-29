.PHONY: install build lint test dev clean

NODE_BIN := ./node_modules/.bin

install:
	npm ci

build:
	npm run build

lint:
	@echo "No lint script configured"

test:
	npm test

dev:
	@echo "No dev script configured"

clean:
	rm -rf dist coverage node_modules
