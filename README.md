# Bank Sync Addon for Wealthfolio

> **Disclaimer:** This is an independent fan project and is not affiliated with, endorsed by, or associated with [SimpleFin](https://simplefin.org) or [Wealthfolio](https://wealthfolio.app) in any way.

A [Wealthfolio](https://wealthfolio.app) addon that pulls your transactions from [SimpleFin Bridge](https://bridge.simplefin.org) and imports them into Wealthfolio — with fuzzy duplicate detection so you never double-count a transaction.

## What it does

This addon secure connects to SimpleFin Bridge's API to fetch your accounts and transactions.

1. You paste a one-time Setup Token from SimpleFin Bridge
2. The addon exchanges it for a persistent Access URL (stored securely in Wealthfolio's secret store)
3. On first sync, you match your SimpleFin accounts to your Wealthfolio accounts.
3. On each subsequent sync, it fetches your accounts and transactions from SimpleFin
4. Incoming transactions are fuzzy-matched against your existing Wealthfolio activities by amount, date, and description
5. You review the results and confirm which transactions to import

The addon caches fetched account data to minimize API calls. You can trigger a manual refresh if you make changes in SimpleFin Bridge or you think there's new transactions to sync.

## Requirements

- [Wealthfolio](https://wealthfolio.app) desktop app
- A subscription to [SimpleFin Bridge](https://bridge.simplefin.org) connected financial institutions

## Permissions

The addon requests the minimum set of permissions needed to function:

| Permission | Purpose |
|---|---|
| `accounts.getAccounts` | Match SimpleFin accounts to Wealthfolio accounts |
| `activities.getActivities` | Load existing transactions for duplicate detection |
| `activities.createActivity` | Import confirmed new transactions |
| `secrets.get/set/delete` | Persist the SimpleFin Access URL between sessions |
| `sidebar.addItem` | Navigation entry point |

## A note on how this was built

Every line of code in this project was written with AI assistance and reviewed by hand before being committed. No generated code ships without a human reading it first.

## License

MIT
