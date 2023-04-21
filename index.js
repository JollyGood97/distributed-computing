import express from "express";
import actuator from "express-actuator";

import { node } from "./NodeInstance.js";
import * as dotenv from "dotenv";
dotenv.config();
import { Eureka as eureka } from "eureka-js-client";
import {
  getAllNodesDetails,
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
let isMaster = node.isMaster;
let higherNodes = [];
let ports = [];
let higherPorts = [];
let masterId = null;
// Register with Eureka Server
const client = new eureka({
  instance: {
    instanceId: node.nodeId,
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

client.start(async (error) => {
  if (error) {
    console.log("Error starting the Eureka Client");
    console.log(error);
    return;
  }
  console.log("Eureka Client started successfully");

  await waitForNodesToStart();
  allInstances = client.getInstancesByAppId(`password-cracker`);
  console.log("allInstances1", allInstances);
  // allInstances = allInstances
  //   ?.filter((instance) => instance.port.$ !== port)
  //   ?.map((instance) => ({
  //     nodeId: instance.instanceId,
  //     port: instance.port,
  //   }));

  console.log("allInstances2", allInstances);
  // @ts-ignore
  ports = allInstances.map((instance) => instance.port.$);
  console.log("ports", ports);

  allInstancesWithDetails = await getAllNodesDetails(ports);
  higherNodes = allInstancesWithDetails.filter(
    (otherNode) => otherNode.nodeId > node.nodeId
  );
  higherPorts = higherNodes.map((node) => node.port);

  //   {
  //     "nodeId": 1826,
  //     "port": "3001",
  //     "isElectionOngoing": false,
  //     "isMaster": false
  // }
  console.log("allInstancesWithDetails", allInstancesWithDetails);

  isMaster = allInstancesWithDetails.some((node) => node.isMaster);
  isElectionOngoing = allInstancesWithDetails.some((node) => node.isElection);

  if (!isMaster && !isElectionOngoing) {
    await waitForElection();
    await startElection(node, higherPorts, ports);
  }
});

app.use(bodyParser.json());
// Routes
app.get("/node", (req, res) => res.json(node));

app.post("/election", async (req, res) => {
  console.log(`Node ${node.nodeId} received an election request.`);

  // Check if the current node is already a master
  if (node.isMaster) {
    console.log(
      `Node ${node.nodeId} is already a master, ignoring the election request.`
    );
    res.status(200).send("I am already the master.");
    return;
  }

  res
    .status(200)
    .send(
      "Acknowledged, I will start an election if I am not already in the election."
    );
  if (!node.isElectionOngoing) {
    await startElection(node, higherPorts);
  }
});

app.post("/master", (req, res) => {
  const { masterId } = req.body;
  console.log(
    `Node ${node.nodeId} received a master announcement. My master node ID is : ${masterId} and he's the ultimate bully.`
  );
  node.isElectionOngoing = false;
  if (node.isMaster && masterId > node.nodeId) {
    node.isMaster = false;
    isMaster = false;
  }
  console.log("Node status inside announcement: ", node);

  res.status(200).send("I accept the master announcement.");
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
  console.error("Uncaught exception:", err);
  gracefulShutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled promise rejection:", reason, "from:", promise);
  gracefulShutdown();
});
