# ADR 0004: Route Runtime telemetry through a Collector

- Status: Accepted
- Date: 2026-07-26
- Goal: goal-02
- Task: G2-P0-B03

## Context

Direct ClickHouse access from every Runtime would distribute database credentials, couple Runtime
availability to an analytics store, and bypass the existing telemetry boundary.

## Decision

Runtime emits telemetry through the configured OpenTelemetry Collector or Telemetry Gateway.
ClickHouse, when used, is downstream infrastructure managed behind that collector.

- Runtime does not receive ClickHouse credentials or connect directly to ClickHouse.
- Telemetry failure does not change Runtime Task Authority or readiness unless a separately
  accepted policy explicitly makes a signal mandatory.
- Collector endpoints and TLS materials follow the configuration Apply Mode and SecretRef/`*_FILE`
  rules.

## Consequences

The collector centralizes batching, retry, redaction, routing, and analytics-store credentials.
Operations must monitor collector delivery separately from Runtime business health.

## Non-goals

Goal 2 does not build a ClickHouse control plane or redefine existing business-event persistence.
