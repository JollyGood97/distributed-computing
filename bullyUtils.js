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
  const nodesDetails = [];
  for (const port of portsList) {
    const url = `http://localhost:${port}/proxy/${port}/node`;
    try {
      const response = await axios.get(url);
      // console.log("response ", response.data);
      nodesDetails.push(response.data);
    } catch (error) {
      console.log("error fetching node details: ", error);
    }
  }
  console.log("nodesDetails ", nodesDetails);
  return nodesDetails;
}

export function onMasterAnnouncementReceived() {
  receivedMasterAnnouncement = true;
}

export async function startElection(node, higherPorts, allPorts) {
  node.isElectionOngoing = true;
  console.log("Inside start election. Higher ports: ", higherPorts);
  console.log("Inside start election. allPorts inc myself: ", allPorts);
  const electionPromises = higherPorts.map(async (port) => {
    try {
      await lock.acquire("postElection", async () => {
        const response = await axios.post(
          `http://localhost:${port}/proxy/${port}/election`,
          { port: ownPort }
        );
        if (response.status === 200) {
          return true;
        }
      });
    } catch (error) {
      console.error("Error in election request:", error);
    }
    return false;
  });

  try {
    const electionResults = await Promise.all(electionPromises);
    console.log("electionResults", electionResults);
    const successfulElections = electionResults.filter((result) => result);
    console.log("successfulElections", successfulElections);
    if (successfulElections.length === 0 && !receivedMasterAnnouncement) {
      await becomemaster(node, allPorts);
    } else {
      node.isElectionOngoing = false;
      console.log(
        "Received Election Msg from a higher node or master announcement, waiting for a master to be elected. Removing myself from the election."
      );
      await checkForMaster(node, allPorts);
    }
  } catch (error) {
    console.error("Error in election promises:", error);
  }
}

export async function becomemaster(node, otherPorts) {
  node.isMaster = true;
  node.isElectionOngoing = false;
  console.log(`Node ${node.nodeId} wants to be the master!`);
  console.log("master", node);

  // Add a random delay between 100ms and 1000ms
  // const delay = Math.floor(Math.random() * (5000 - 1000) + 1000);

  // console.log(`Waiting for ${delay} seconds before announcing the master.`);
  // await new Promise((resolve) => setTimeout(resolve, delay));

  let allPorts = otherPorts || [];
  // allPorts.push(ownPort);

  const masterPromises = allPorts.map(async (port) => {
    try {
      await axios.post(`http://localhost:${port}/proxy/${port}/master`, {
        masterId: node.nodeId,
      });
      await axios.post(`http://localhost:${port}/master-announcement-received`);
    } catch (error) {
      console.error("Error in master announcement:", error);
    }
  });

  await Promise.all(masterPromises);
}

export async function checkForMaster(node, allPorts) {
  while (!node.masterNodeId) {
    console.log(`Node ${node.nodeId} is checking for master.`);
    const nodesDetails = await getAllNodesDetails(allPorts);
    const masterNode = nodesDetails.find((node) => node.isMaster);
    const allElectionsFinished = nodesDetails.every(
      (otherNode) =>
        !otherNode.isElectionOngoing || otherNode.nodeId === node.nodeId
    );

    if (masterNode && allElectionsFinished) {
      node.masterNodeId = masterNode.nodeId;
      console.log(`Node ${node.nodeId} found master: ${masterNode.nodeId}`);
      node.isElectionOngoing = false;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
