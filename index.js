import express from "express";
import actuator from "express-actuator";
import Consul from "consul";
import events from "events";
const eventEmitter = new events.EventEmitter();

import { node } from "./NodeInstance.js";
import * as dotenv from "dotenv";
dotenv.config();
import { Eureka as eureka } from "eureka-js-client";
import {
  getAllNodesDetails,
  onMasterAnnouncementReceived,
  resetMasterAnnouncement,
  startElection,
  waitForElection,
  waitForNodesToStart,
} from "./bullyUtils.js";
import axios from "axios";
import sidecarProxy from "./sidecarProxy.js";
import bodyParser from "body-parser";
import {
  divideWorkload,
  readPasswordFile,
  sendCompletionMessage,
} from "./masterUtils.js";
import { sendWorkload } from "./masterUtils.js";
import { sendPasswordToMaster } from "./slaveUtils.js";

const app = express();
const port = process.env.PORT || 3000;

console.log("My details: " + JSON.stringify(node));

let allInstances = [];
let allInstancesWithDetails = [];
let isElectionOngoing = node.isElectionOngoing;
let masterHasBeenElected = node.isMaster;
let masterNodeId = null;
let higherNodes = [];
let ports = [];
let higherPorts = [];
let masterId = null;
let allNodes = null;

const consul = new Consul();
const serviceName = "password-cracker";

consul.agent.service.register(
  {
    name: serviceName,
    id: node.nodeId.toString(),
    address: "localhost",
    port: Number(port),
    check: {
      http: `http://localhost:${port}/actuator/health`,
      interval: "10s",
    },
  },
  (err) => {
    if (err) {
      console.log("Error registering service with Consul");
      console.log(err);
      return;
    } else {
      console.log(err);
    }

    // The rest of your logic goes here
  }
);

const getServiceNodes = async () => {
  const services = await consul.agent.service.list();
  return services;
};

async function isNodeDown(serviceId) {
  try {
    const response = await axios.get(
      `http://127.0.0.1:8500/v1/agent/health/service/id/${serviceId}?format=text`
    );
    const healthStatus = response.data;
    // console.log("health status: " + healthStatus);
    return healthStatus === "critical";
  } catch (error) {
    if (
      error.response &&
      error.response.status === 503 &&
      error.response.data === "critical"
    ) {
      console.log(
        "health status error response: " +
          JSON.stringify(error.response.data) +
          serviceId
      );
      return true;
    }
    // console.error(
    //   `Error checking node status: ${error.message}`,
    //   JSON.stringify(error)
    // );
    // return false;
    return true;
  }
}

const getActiveNodes = async (nodes) => {
  const activeNodes = [];
  for (const serviceId in nodes) {
    const node = nodes[serviceId];
    if (await isNodeDown(serviceId)) {
      console.log(`Node with service ID ${serviceId} is down.`);
    } else {
      activeNodes.push(node);
    }
  }
  return activeNodes;
};

const monitorMasterNode = async (masterServiceId) => {
  const checkInterval = 5000;

  setInterval(async () => {
    if (await isNodeDown(masterServiceId)) {
      console.log(
        `Master node ${masterServiceId} is down. Starting a new election.`
      );
      resetMasterAnnouncement();
      node.masterNodeId = null;
      node.isMaster = false;
      node.isElectionOngoing = false;
      startFirstPhase();
    }
  }, checkInterval);
};

const startFirstPhase = async () => {
  try {
    allInstances = await getServiceNodes();

    console.log(`allInstances`, allInstances);

    // Get the ports of all the instances

    ports = Object.values(allInstances).map((instance) => instance.Port);
    console.log(`ports`, ports);

    // Get details of all nodes and filter the higher nodes
    allInstancesWithDetails = await getAllNodesDetails(ports);
    console.log("nodewithdetails0", JSON.stringify(allInstancesWithDetails));

    higherNodes = allInstancesWithDetails.filter(
      (otherNode) => otherNode.nodeId > node.nodeId
    );
    higherPorts = higherNodes.map((node) => node.port);

    // Check if a master has already been elected or if an election is ongoing
    masterHasBeenElected = allInstancesWithDetails.some(
      (node) => node.isMaster
    );
    isElectionOngoing = allInstancesWithDetails.some((node) => node.isElection);

    if (!masterHasBeenElected && !isElectionOngoing) {
      // Wait for a random amount of time before starting the election
      const electionWaitTime = Math.floor(
        Math.random() * (15000 - 5000) + 5000
      );
      console.log(
        `Starting the election in ${electionWaitTime / 1000} seconds!`
      );
      setTimeout(async () => {
        await startElection(node, higherPorts, ports);
      }, electionWaitTime);
    } else {
      let masterNode = allInstancesWithDetails.find((node) => node.isMaster);
      node.isMaster = false;
      node.isElectionOngoing = false;
      node.masterNodeId = masterNode.nodeId;
      console.log("Master has already been elected", masterHasBeenElected);
      console.log("isElectionOngoing", isElectionOngoing);
      console.log("nodewithdetails1", JSON.stringify(allInstancesWithDetails));
    }
  } catch (err) {
    console.log("Error fetching service instances from Consul");
    console.log(err);
  }
};

let shouldStop = false;
const passwords = readPasswordFile("passwords.txt");
let currentPasswordIndex = 0;
console.log("Passwords list from file", passwords);
let solverNodeId = null;

const startMasterPhase = async () => {
  try {
    let latestInstances = await getServiceNodes();

    // Filter only active nodes
    latestInstances = await getActiveNodes(latestInstances);

    const latestPorts = Object.values(latestInstances).map(
      (instance) => instance.Port
    );
    shouldStop = false;
    allNodes = await getAllNodesDetails(latestPorts);

    // Divide the workload among slave nodes. call again in divideWorkload call
    const slaveNodes = allNodes.filter((n) => !n.isMaster);

    // Divide the workload among nodes
    const workload = divideWorkload(slaveNodes);
    console.log("Start round ", currentPasswordIndex);

    // Send the assigned workload to each node
    const workloadPromises = [];
    for (const nodeId in workload) {
      const assignedRange = workload[nodeId];
      const targetPort = slaveNodes.find(
        (node) => node.nodeId === parseInt(nodeId)
      ).port;

      workloadPromises.push(
        sendWorkload(
          targetPort,
          assignedRange,
          currentPasswordIndex,
          shouldStop
        )
      );
    }

    await Promise.all(workloadPromises);
  } catch (err) {
    console.log("Error fetching service instances from Consul");
    console.log(err);
  }
};

console.log("wait 3 seconds to discover all instances");
setTimeout(() => {
  startFirstPhase();
}, 3000);

let jobDone = false;
eventEmitter.on("masterAnnounced", async (masterNodeId) => {
  // console.log("After election only this code runs.");
  console.log(JSON.stringify(node));
  if (node.isMaster) {
    console.log("Node is master, starting master tasks.");
    await startMasterPhase();
  } else {
    console.log("Node is slave, waiting for slave tasks.");
    // await startSlavePhase();
  }
  if (masterNodeId !== node.masterNodeId && jobDone === false) {
    monitorMasterNode(masterNodeId);
  }
});

app.use(bodyParser.json());
// Routes
app.post("/master-announcement-received", (req, res) => {
  onMasterAnnouncementReceived();
  res.status(200).send("Master announcement received.");
});

app.get("/node", (req, res) => res.json(node));

app.post("/election", async (req, res) => {
  const { port } = req.body;
  console.log(`Node ${node.nodeId} received an election request.`);
  // console.log(
  //   "At the time of receiving an election request, my details are: " +
  //     JSON.stringify(node)
  // );
  // Check if the current node is already a master
  if (node.isMaster) {
    console.log(
      `Node ${node.nodeId} is already a master, ignoring the election request.`
    );

    // UNCOMMENT IF NOT WORKING
    // axios
    //   .post(`http://localhost:${port}/master`, { masterId: node.nodeId })
    //   .then((response) => {
    //     console.log(response.data);
    //   })
    //   .catch((error) => {
    //     console.log(error);
    //   });
    res.status(200).send("I am already the master.");
    return;

    // return;
  }

  if (!node.isElectionOngoing) {
    try {
      res.status(200).send("Acknowledged, I will start an election.");
      await startElection(node, higherPorts, ports);
    } catch (error) {
      console.error("Error starting the election:", error);
    }
  } else {
    res.status(200).send("Acknowledged, I have already started the election.");
  }
});

app.post("/master", (req, res) => {
  onMasterAnnouncementReceived();
  const { masterId } = req.body;

  if (node.masterNodeId > masterId) {
    console.log(
      `Node ID ${node.nodeId} says that master is already decided. Master node ID is : ${node.masterNodeId} and the ultimate bully.`
    );
    res.status(200);
    return;
  }
  if (masterId > node.nodeId) {
    node.isMaster = false;
    node.masterNodeId = masterId;
  } else {
    node.isMaster = true;
    node.masterNodeId = node.nodeId;
  }
  masterHasBeenElected = true;
  console.log("Node status now: ", node);
  node.isElectionOngoing = false;
  console.log(
    `Node ID ${node.nodeId} says that Master announcement has been made. Master node ID is : ${node.masterNodeId} and the ultimate bully.`
  );
  res.status(200).send(`Node ${node.nodeId} accepts the master announcement.`);
  eventEmitter.emit("masterAnnounced", node.masterNodeId);
});

function* getPasswordCombinations(range, length, prefix = "") {
  if (length === 0) {
    yield prefix;
    return;
  }

  for (const char of range) {
    yield* getPasswordCombinations(range, length - 1, prefix + char);
  }
}

app.post("/workload", async (req, res) => {
  res.sendStatus(200);

  const assignedRange = req.body.range;
  const round = req.body.round;
  const port = req.body.port;

  console.log(
    `Node on port ${port} says, "Received workload for pwd line ${round}"`
  );

  const allInstances = await getServiceNodes();
  // Filter only active nodes
  //  latestInstances = await getActiveNodes(latestInstances);

  const ports = Object.values(allInstances).map((instance) => instance.Port);
  const allNodes = await getAllNodesDetails(ports);
  // console.log(`Received allNodes: ${JSON.stringify(allNodes)}`);

  const masterPort = allNodes.find((n) => n.nodeId === node.masterNodeId).port;

  // Start processing the workload
  for (const password of getPasswordCombinations(assignedRange, 6)) {
    if (shouldStop) {
      break;
    }
    if (await isNodeDown(node.masterNodeId)) {
      console.log(
        `Master node ${node.masterNodeId} is down. Starting a new election.`
      );
      resetMasterAnnouncement();
      node.masterNodeId = null;
      node.isMaster = false;
      node.isElectionOngoing = false;
      startFirstPhase();
      break;
    }

    await sendPasswordToMaster(masterPort, password, node.nodeId);
  }
});

app.post("/update-stop", (req, res) => {
  const stop = req.body.stop;
  shouldStop = stop;
  console.log("Updated shouldStop status: ", shouldStop);
  res.sendStatus(200);
});

app.post("/completion", (req, res) => {
  const message = req.body.message;
  console.log("message", message);
  if (message === "passwordMatch" || message === "nextPassword") {
    shouldStop = true;
  }

  console.log("Password has been cracked, waiting for next schedule.");
  res.sendStatus(200);
});

app.post("/end", (req, res) => {
  jobDone = true;
  console.log(
    "All passwords in the file have been cracked. Bye, have a nice day!"
  );
  res.sendStatus(200);
});

app.post("/verify", async (req, res) => {
  let passwordMatch = false;

  const receivedPassword = req.body.password;
  const nodeId = req.body.nodeId;
  // console.log(passwords[currentPasswordIndex] + ": " + receivedPassword);
  if (receivedPassword === passwords[currentPasswordIndex]) {
    passwordMatch = true;
    solverNodeId = nodeId;
    console.log(`Password match found by node ${nodeId}: ${receivedPassword}`);
  }

  if (passwordMatch) {
    await sendCompletionMessage(allNodes, true);
    currentPasswordIndex++;

    if (currentPasswordIndex < passwords.length) {
      // Send the workload for the next password
      console.log("Starting next pwd", passwords[currentPasswordIndex]);
      await startMasterPhase();
    } else {
      for (const node of allNodes) {
        await axios.post(`http://localhost:${node.port}/end`);
      }
    }
  }

  res.json({ match: passwordMatch });
});

// Start the Node
app.listen(port, () => {
  console.log(`Node listening on port ${port}.`);
});

const options = {
  basePath: "/actuator", // It will set /actuator/info instead of /info
};

app.use(sidecarProxy);
app.use(actuator(options));

async function gracefulShutdown() {
  console.log("Shutting down gracefully...");
  await consul.agent.service.deregister(
    { id: node.nodeId.toString() },
    (err) => {
      console.log("Error de-registering service:", err);

      process.exit();
    }
  );
  console.log("Deregistered");
  process.exit();
}

// console.log("Node status after announcement: ", node);

//Handle various exit signals
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
process.on("SIGHUP", gracefulShutdown);

// Handle uncaught exceptions and unhandled promise rejections
process.on("uncaughtException", (err) => {
  console.error(err);
  console.log("Node NOT Exiting...");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled promise rejection:", reason, "from:", promise);
  console.log("Node NOT Exiting...");
});
