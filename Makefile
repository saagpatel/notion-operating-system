.PHONY: install build lint test check clean

install:
	npm ci

build:
	npm run build

lint:
	npm run lint

test:
	npm test

check:
	@test -d node_modules || { echo "Dependencies are missing. Run npm ci before make check." >&2; exit 1; }
	npm run check

clean:
	rm -rf dist coverage node_modules
