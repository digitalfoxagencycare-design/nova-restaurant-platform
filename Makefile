.PHONY: install test lint scan check run
install:
	pip install -r backend/requirements-dev.txt
test:
	cd backend && python -m pytest -o addopts="" -q
lint:
	cd backend && ruff check .
scan:
	python scripts/scan_secrets.py
agent-test:
	cd print-agent && npm test
check: lint scan test agent-test
run:
	cd backend && uvicorn nova.app:create_app --factory --reload --port 8000
