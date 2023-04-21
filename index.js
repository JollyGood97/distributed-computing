import express from "express";
import actuator from "express-actuator";

import { node } from "./NodeInstance.js";
import * as dotenv from "dotenv";
dotenv.config();
import { Eureka as eureka } from "eureka-js-client";
import {
  getAllNodesDetails,
  onMasterAnnouncementReceived,
  startElection,
  waitForElection,
  waitForNodesToStart,
} from "./bullyUtils.js";
import axios from "axios";
import sidecarProxy from "./sidecarProxy.js";
import bodyParser from "body-parser";

const app = express();
const port = parseInt(process.env.PORT) || 3000;

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
// Register with Eureka Server
const client = new eureka({
  instance: {
    // instanceId: node.nodeId,
    app: "password-cracker",
    hostName: "localhost",
    ipAddr: "127.0.0.1",
    statusPageUrl: `http://localhost:${process.env.PORT}/actuator/info`,
    healthCheckUrl: `http://localhost:${process.env.PORT}/actuator/health`,
    vipAddress: "password-cracker",
    dataCenterInfo: {
      name: "MyOwn",
      "@class": "com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo",
    },
    port: {
      $: port,
      "@enabled": true,
    },

    // leaseInfo: {
    //   renewalIntervalInSecs: 5,
    //   durationInSecs: 5,
    //   registrationTimestamp: parseInt(Date()),
    // },
  },
  eureka: {
    // registryFetchInterval: 1,
    // fetchRegistry: true,
    host: "localhost",
    port: 8761,
    servicePath: "/eureka/apps/",
    heartbeatInterval: 1000,
  },
});

async function updateInstances() {
  allInstances = client.getInstancesByAppId("password-cracker");
  // @ts-ignore
  ports = allInstances.map((instance) => instance.port.$);
  allInstancesWithDetails = await getAllNodesDetails(ports);
  higherNodes = allInstancesWithDetails.filter(
    (otherNode) => otherNode.nodeId > node.nodeId
  );
  higherPorts = higherNodes.map((node) => node.port);

  console.log("allInstancesWithDetails", allInstancesWithDetails);
}

// async function fetchEurekaInstances() {
//   try {
//     const response = await axios.get(
//       "http://localhost:8761/eureka/apps/password-cracker"
//     );
//     console.log("Eureka server response:", response.data);
//   } catch (error) {
//     console.log("Error fetching instances from Eureka server:", error);
//   }
// }

async function initiateElectionProcess() {
  while (!node.masterNodeId) {
    allInstances = client.getInstancesByAppId(`password-cracker`);
    console.log("allInstances", allInstances);
    // @ts-ignore
    ports = allInstances.map((instance) => instance.port.$);

    allInstancesWithDetails = await getAllNodesDetails(ports);
    higherNodes = allInstancesWithDetails.filter(
      (otherNode) => otherNode.nodeId > node.nodeId
    );
    higherPorts = higherNodes.map((node) => node.port);

    masterHasBeenElected = allInstancesWithDetails.some(
      (node) => node.isMaster
    );
    isElectionOngoing = allInstancesWithDetails.some((node) => node.isElection);

    if (!masterHasBeenElected && !isElectionOngoing) {
      await waitForElection();
      await startElection(node, higherPorts, ports);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second before checking again
  }
}

client.start(async (error) => {
  if (error) {
    console.log("Error starting the Eureka Client");
    console.log(error);
    return;
  }
  console.log("Eureka Client started successfully");

  await waitForNodesToStart();
  await initiateElectionProcess();
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

  // Check if the current node is already a master
  if (node.isMaster) {
    console.log(
      `Node ${node.nodeId} is already a master, ignoring the election request.`
    );
    axios
      .post(`http://localhost:${port}/master`, { masterId: node.nodeId })
      .then((response) => {
        console.log(response.data);
      })
      .catch((error) => {
        console.log(error);
      });
    res.status(200).send("I am already the master.");
    return;

    // return;
  }

  res
    .status(200)
    .send(
      "Acknowledged, I will start an election if I am not already in the election."
    );
  if (!node.isElectionOngoing) {
    try {
      await startElection(node, higherPorts, ports);
    } catch (error) {
      console.error("Error starting the election:", error);
    }
  }
});

app.post("/master", (req, res) => {
  const { masterId } = req.body;
  console.log(
    `Node ID ${node.nodeId} says that Master announcement has been made. Master node ID is : ${masterId} and the ultimate bully.`
  );
  node.isElectionOngoing = false;
  if (node.isMaster && masterId > node.nodeId) {
    node.isMaster = false;
    masterHasBeenElected = true;
  }
  node.masterNodeId = masterId;
  console.log("Node status inside announcement: ", node);
  res.status(200).send(`Node ${node.nodeId} accepts the master announcement.`);
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
function gracefulShutdown() {
  console.log("Shutting down gracefully...");
  client.stop((err) => {
    if (err) {
      console.log("Error stopping Eureka client", err);
    } else {
      console.log("Eureka client stopped successfully");
      process.exit(0);
    }
  });
}

console.log("Node status after announcement: ", node);

// Handle various exit signals
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
