import random from "random";
import axios from "axios";

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
    }, 4000);
  });
}

export function waitForElection() {
  return new Promise((resolve) => {
    const waitTime = Math.floor(Math.random() * 10) + 1;
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

export async function startElection(node, higherPorts, allPorts) {
  node.isElectionOngoing = true;
  const electionPromises = higherPorts.map(async (port) => {
    try {
      const response = await axios.post(
        `http://localhost:${port}/proxy/${port}/election`
      );
      if (response.status === 200) {
        return true;
      }
    } catch (error) {
      console.error("Error in election request:", error);
    }
    return false;
  });

  const electionResults = await Promise.all(electionPromises);
  const successfulElections = electionResults.filter((result) => result);
  if (successfulElections.length === 0) {
    await becomemaster(node, allPorts);
  } else {
    node.isElectionOngoing = false;
    console.log(
      "Received Election Msg from a higher node, waiting for a master to be elected. Removing myself from the election."
    );
  }
}

export async function becomemaster(node, allPorts) {
  node.isMaster = true;
  node.isElectionOngoing = false;
  console.log(`Node ${node.nodeId} wants to be the master!`);
  console.log("master", node);
  const masterPromises = allPorts.map(async (port) => {
    try {
      await axios.post(`http://localhost:${port}/master`, {
        masterId: node.nodeId,
      });
    } catch (error) {
      console.error("Error in master announcement:", error);
    }
  });

  await Promise.all(masterPromises);
}

// export async function startElection(node, higherPortsList){

// }
