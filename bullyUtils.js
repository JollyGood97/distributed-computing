import random from "random";
import axios from "axios";
import AsyncLock from "async-lock";
const lock = new AsyncLock();

const ownPort = parseInt(process.env.PORT) || 3000;
let receivedMasterAnnouncement = false;

export function generateNodeId() {
  const timestamp = Date.now().toString().slice(-4);
  const randomInt = random.int(0, 1000);
  const nodeId = parseInt(timestamp, 10) + randomInt;
  return nodeId;
}

export function waitForNodesToStart() {
  return new Promise((resolve) => {
    console.log(`Waiting for nodes to start...`);
    setTimeout(() => {
      resolve();
    }, 3000);
  });
}

export function waitForElection() {
  return new Promise((resolve) => {
    const waitTime = Math.floor(Math.random() * (15 - 5) + 5);
    console.log(`Starting an election in ${waitTime} seconds!`);
    setTimeout(() => {
      resolve();
    }, waitTime * 1000);
  });
}

export async function getAllNodesDetails(portsList) {
  const requestTimeout = 4000;

  const nodesDetailsPromises = portsList.map(async (port) => {
    const url = `http://localhost:5000/proxy/${port}/node`;
    try {
      const response = await axios.get(url, { timeout: requestTimeout });
      return response.data;
    } catch (error) {
      console.log("error fetching node details for port", port, ":", error);
      return null;
    }
  });

  const results = await Promise.all(nodesDetailsPromises);
  const nodesDetails = results.filter((result) => result !== null);

  return nodesDetails;
}

export function onMasterAnnouncementReceived() {
  receivedMasterAnnouncement = true;
}

export function resetMasterAnnouncement() {
  receivedMasterAnnouncement = false;
}

export async function startElection(node, higherPorts, allPorts) {
  node.isElectionOngoing = true;
  if (receivedMasterAnnouncement) {
    node.isElectionOngoing = false;
    return;
  }

  const electionPromises = higherPorts.map(async (port) => {
    try {
      const result = await lock.acquire("postElection", async () => {
        const response = await axios.post(
          `http://localhost:5000/proxy/${port}/election`,
          { port: ownPort }
        );

        if (response.status === 200) {
          return true;
        } else {
          return false;
        }
      });
      return result;
    } catch (error) {
      console.error("Error in election request:", error);
      return false;
    }
  });

  try {
    const electionResults = await Promise.all(electionPromises);
    const successfulElections = electionResults.filter((result) => result);

    if (successfulElections.length === 0 && !receivedMasterAnnouncement) {
      await becomemaster(node, allPorts);
    } else {
      node.isElectionOngoing = false;
      console.log(
        "Received Election Response OK from a higher node. Removing myself from the election."
      );
    }
  } catch (error) {
    console.error("Error in election promises:", error);
  }
}

export async function becomemaster(node, otherPorts) {
  node.isMaster = true;
  node.isElectionOngoing = false;
  console.log(`Node ${node.nodeId} wants to be the master!`);
  let allPorts = otherPorts || [];

  const masterPromises = allPorts.map(async (port) => {
    try {
      await axios.post(`http://localhost:5000/proxy/${port}/master`, {
        masterId: node.nodeId,
      });
      await axios.post(
        `http://localhost:5000/proxy/${port}/master-announcement-received`
      );
    } catch (error) {
      console.error("Error in master announcement:", error);
    }
  });

  await Promise.all(masterPromises);
}
