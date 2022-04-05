<!-- markdownlint-disable MD033 -->
# <img src="assets/logo.png" alt="IDEX" height="36px" valign="top"> Staking Replicator

![Discord](https://img.shields.io/discord/455246457465733130?label=Discord&style=flat)
![GitHub](https://img.shields.io/github/license/idexio/staking-replicator?style=flat)
![GitHub issues](https://img.shields.io/github/issues/idexio/staking-replicator?style=flat)

![Twitter Follow](https://img.shields.io/twitter/follow/idexio?style=social)

## Introduction

IDEX Staking Replicator is software that enables the [IDEX](https://idex.io/) community to stake IDEX tokens, serve
parts of the IDEX production infrastructure, and earn fees for participation. Replicator is an all-new, lightweight
staking client featuring lower resource requirements and dramatically improved stability. For complete coverage,
motivation, and details of operation, see our most recent post on [Replicator Staking](https://blog.idex.io/all-posts/replicator-staking-is-now-live).

* To get a Staking Key and get started with Replicator staking, visit the [staking page](https://exchange.idex.io/staking/replicator)
in the IDEX web client. All status and earnings information is now available through the web client.
* For details on implementing an IDEX API consumer that uses Replicators, see the [IDEX API documentation](https://api-docs-v3.idex.io/#api-replicator).

Replicator replaces the legacy [IDEXd staking client](https://github.com/idexio/IDEXd). Replicator is available
immediately and replaces IDEXd earning staking credits starting on 2020-12-21 00:00 UTC.

## Table of Contents

* [Requirements](#requirements)
  * [Staking](#staking)
  * [Hardware / VPS](#hardware--vps)
  * [Software](#software)
* [Getting Started](#getting-started)
  * [A note on users](#a-note-on-users)
  * [Install Docker](#install-docker)
  * [Start Replicator](#start-replicator)
    * [A note on connectivity](#a-note-on-connectivity)
* [Managing Replicator](#managing-replicator)
  * [Examining logs](#examining-logs)
  * [Stopping Replicator](#stopping-replicator)
  * [Upgrading Replicator](#upgrading-replicator)
  * [Customizing Replicator's configuration](#customizing-replicators-configuration)
* [Recommendations](#recommendations)
  * [Disk space](#disk-space)
    * [Ubuntu Kernel Updates](#ubuntu-kernel-updates)
    * [Replicator Updates](#replicator-updates)
* [Getting Help and Reporting Issues](#getting-help-and-reporting-issues)
* [License](#license)

## Requirements

### Staking

In order to participate in the IDEX Replicator staking program, you must have a wallet that holds a minimum of 5,000
IDEX. There is no incubation period. Any wallet with 5,000 IDEX or more is immediately eligible.

### Hardware / VPS

Replicator is designed to run on a computer or inexpensive VPS that is continually connected to the internet with a
stable IP address and inbound connectivity. It requires at minimum:

* 1 GB memory
* 2 GB storage

The least expensive tier of many cloud computing providers meets these requirements.

### Software

Staking Replicator is distributed as a Docker image and has very few dependencies. While it should run in any
environment where Docker is supported, the following configuration is recommended by IDEX at launch:

* Ubuntu 20.04 LTS
* Docker Engine ([Installation Guide](https://docs.docker.com/engine/install/ubuntu/))

## Getting Started

Docker provides first-rate installation documentation, but we've collected the key steps to get up and running here.
Start with a freshly installed copy of Ubuntu 20.04.

**Note: Existing IDEXd stakers already have Docker configured. Skip ahead to [Start Replicator](#start-replicator) to
get started in under a minute.**

### A note on users

Some cloud computing providers, such as Digital Ocean, set up new Ubuntu 20.04 instances with only the `root` user
account configured. We recommend running Replicator as a regular user account rather than `root`. When you first log in,
run `whoami` to check which user you are currently acting as. If the response is `root`, follow Digital Ocean's
[instructions](https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-20-04) on adding a user
and adding sudo privileges in order to run Replicator.

Log out and log in to the new, non-`root` user account before proceeding.

### Install Docker

1. Add Docker’s official GPG key

   ```
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
   ```

1. Add the stable Docker repository

   ```
   sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
   ```

1. Update packages

   ```
   sudo apt-get update
   ```

1. Install the Docker Engine packages

   ```
   sudo apt-get install docker-ce docker-ce-cli containerd.io
   ```

1. Add your user to the `docker` group to avoid permissions issues

   ```
   sudo usermod -aG docker ${USER}
   ```

1. Log out and log back in and `docker` [commands](https://docs.docker.com/) will be available from the prompt.

1. Verify that Docker Engine is installed correctly by running the `hello-world` image

   ```
   docker run hello-world
   ```

### Start Replicator

1. Download the Replicator start script

   ```
   wget "https://raw.githubusercontent.com/idexio/staking-replicator/main/scripts/start-idex-replicator.sh"
   ```

1. Enable script permissions

   ```
   chmod a+x start-idex-replicator.sh
   ```

1. Run the start script to get started

   ```
   ./start-idex-replicator.sh
   ```

The start script will prompt for a Staking Key, which can be found on the [Replicator Staking page](https://exchange.idex.io/staking/replicator).

#### A note on connectivity

In order to serve data to IDEX API users, Replicator must be reachable from the public internet. Most home and office
connections are not publicly reachable by default, so you may need to take steps like opening up specific ports on your
router. Replicator requires public TCP access to port 8081 and has limits on how frequently a node can change IP
addresses.

We recommend running Replicator on an always-on, connected machine or a cloud-hosted compute instance.

## Managing Replicator

Replicator is designed to require minimal maintenance once live. All status and earnings information is available on the
[Replicator Staking](https://exchange.idex.io/staking/replicator) page.

### Examining logs

Activity and Error logs are available in the `idex-staking-replicator/logs` directory.

```
tail -f idex-staking-replicator/logs/activity.log
```

### Stopping Replicator

Replicator can be taken offline via Docker.

```
docker stop staking-replicator
```

Re-running the `start-idex-replicator.sh` script will bring Replicator back online.

### Upgrading Replicator

Replicator includes an automatic update mechanism to keep it up to date without intervention. To manually upgrade, stop
and restart Replicator.

### Customizing Replicator's configuration

Replicator includes minimal configuration options by design, but it is possible to set a custom configuration file.
Create a file `idex-staking-replicator/conf/config.env`.

Settings include:

```
API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
IDEX_STAKING_SERVER_PORT=8081
```

* Setting an `API_KEY` makes it unnecessary to supply an Staking Key on start.
* If port 8081 is unavailable, a custom port may be specified via `IDEX_STAKING_SERVER_PORT`.

## Recommendations

### Disk space

Replicator limits the size of the three log files it writes to 50 MB each. No other data is written to disk by
Replicator itself.

Follow these recommendations to reclaim disk space lost to common causes.

#### Ubuntu Kernel Updates

If you are running Ubuntu (as recommended), automatic kernel updates are likely enabled. These updates leave old kernels
behind in `/usr/src/`, which can be cleaned up with `sudo apt-get autoremove`. To automate this, set up the following
cron job:

```
crontab -e
```

Add line:

```
0 0 * * * sudo apt-get -y autoremove
```

This runs the command every day at midnight.

#### Replicator Updates

Replicator includes an automatic update mechanism, which can leave behind unused Docker images. Unused Docker images
can be removed by running `docker image prune`.

## Getting Help and Reporting Issues

For questions about getting started and help if you're stuck, please [reach out to our team on Discord](https://discord.gg/tQa9CAB).

If you believe you have identified a bug in Replicator, please [file an issue](https://github.com/idexio/staking-replicator/issues).

## License

IDEX Replicator Client is released under the [MIT License](https://opensource.org/licenses/MIT).
