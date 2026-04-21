---
description: Explain the /wpa:* command set.
---

# /wpa:help

Give the user this reference list:

| Command           | What it does                                                                |
| ----------------- | --------------------------------------------------------------------------- |
| `/wpa:init`       | First-run setup; generates `.env` and random secrets                        |
| `/wpa:start`      | `docker compose up -d`; waits healthy; opens dashboard                      |
| `/wpa:stop`       | `docker compose down`                                                       |
| `/wpa:status`     | Container health + app readiness                                            |
| `/wpa:logs <svc>` | Tail filtered logs                                                          |
| `/wpa:kill`       | Emergency: mute assistant + close sockets (P3 wires sockets; P0 mutes flag) |
| `/wpa:help`       | This list                                                                   |

Deploy and upgrade commands (`/wpa:deploy`, `/wpa:update`, `/wpa:backup`, etc.) land in later phases.
