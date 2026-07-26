.PHONY: quality compose-smoke

quality:
	git diff --check HEAD
	test -f LICENSE
	grep -Fq 'Apache License' LICENSE

compose-smoke:
	docker compose -f compose.yml up --abort-on-container-exit --exit-code-from smoke
