import express from "express";
import actuator from "express-actuator";
import Consul from "consul";

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

const consul = new Consul();
const serviceName = "password-cracker";

// Register with Eureka Server
// const client = new eureka({
//   instance: {
//     instanceId: node.nodeId,
//     app: "password-cracker",
//     hostName: `localhost:${port}`,
//     ipAddr: "127.0.0.1",
//     statusPageUrl: `http://localhost:${process.env.PORT}/actuator/info`,
//     healthCheckUrl: `http://localhost:${process.env.PORT}/actuator/health`,
//     vipAddress: `password-cracker-${port}.com`,
//     dataCenterInfo: {
//       name: "MyOwn",
//       "@class": "com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo",
//     },
//     port: {
//       $: Number(port),
//       "@enabled": true,
//     },

//     // leaseInfo: {
//     //   renewalIntervalInSecs: 5,
//     //   durationInSecs: 5,
//     //   registrationTimestamp: parseInt(Date()),
//     // },
//   },
//   eureka: {
//     registryFetchInterval: 100,
//     fetchRegistry: true,
//     fetchMetadata: true,
//     host: "localhost",
//     port: 8761,
//     servicePath: "/eureka/apps/",
//     // heartbeatInterval: 1000,
//   },
// });

// async function updateInstances() {
//   allInstances = client.getInstancesByAppId("password-cracker");
//   // @ts-ignore
//   ports = allInstances.map((instance) => instance.port.$);
//   allInstancesWithDetails = await getAllNodesDetails(ports);
//   higherNodes = allInstancesWithDetails.filter(
//     (otherNode) => otherNode.nodeId > node.nodeId
//   );
//   higherPorts = higherNodes.map((node) => node.port);

//   console.log("allInstancesWithDetails", allInstancesWithDetails);
// }

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

// Wait for a period of time before starting the election process
// const waitTime = Math.floor(Math.random() * (15000 - 5000) + 5000);
// console.log(
//   `Waiting for ${
//     waitTime / 1000
//   } seconds before starting nodes discovery on service registry...`
// );

const getServiceNodes = async () => {
  const services = await consul.agent.service.list();
  return services;
};

const startFirstPhase = async () => {
  try {
    const allInstances = await getServiceNodes();

    console.log(`allInstances`, allInstances);

    // Get the ports of all the instances

    ports = Object.values(allInstances).map((instance) => instance.Port);
    console.log(`ports`, ports);

    // Get details of all nodes and filter the higher nodes
    allInstancesWithDetails = await getAllNodesDetails(ports);
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
        // await waitForElection();
        await startElection(node, higherPorts, ports);
      }, electionWaitTime);
    }
  } catch (err) {
    console.log("Error fetching service instances from Consul");
    console.log(err);
  }
};

console.log("wait 5 seconds to discover all instances");
setTimeout(() => {
  startFirstPhase();
}, 5000);

// client.start(async (error) => {
//   if (error) {
//     console.log("Error starting the Eureka Client");
//     console.log(error);
//     return;
//   }
//   console.log("Eureka Client started successfully");

//   setTimeout(async () => {
//     // Check if an election is ongoing or if a master has already been elected
//     // if (isElectionOngoing || masterHasBeenElected) {
//     //   console.log(
//     //     "An election is already ongoing or a master has already been elected. Exiting 1..."
//     //   );
//     //   return;
//     // }

//     // Set a flag to indicate that an election is ongoing

//     // Fetch all the instances of the `password-cracker` application from Eureka
//     const allInstances = client.getInstancesByAppId(`password-cracker`);
//     console.log(`allInstances`, allInstances);

//     // Get the ports of all the instances of the `password-cracker` application
//     // @ts-ignore
//     ports = allInstances.map((instance) => instance.port.$);

//     // Get details of all nodes and filter the higher nodes
//     allInstancesWithDetails = await getAllNodesDetails(ports);
//     higherNodes = allInstancesWithDetails.filter(
//       (otherNode) => otherNode.nodeId > node.nodeId
//     );
//     higherPorts = higherNodes.map((node) => node.port);

//     // Check if a master has already been elected or if an election is ongoing
//     masterHasBeenElected = allInstancesWithDetails.some(
//       (node) => node.isMaster
//     );
//     isElectionOngoing = allInstancesWithDetails.some((node) => node.isElection);

//     if (!masterHasBeenElected && !isElectionOngoing) {
//       // Wait for a random amount of time before starting the election
//       const electionWaitTime = Math.floor(
//         Math.random() * (15000 - 5000) + 5000
//       );
//       console.log(
//         `Starting the election in ${electionWaitTime / 1000} seconds!`
//       );
//       setTimeout(async () => {
//         // await waitForElection();
//         await startElection(node, higherPorts, ports);
//       }, electionWaitTime);
//     } else {
//       console.log(
//         "A master has already been elected or an election is ongoing. Exiting 2..."
//       );
//     }
//   }, waitTime);
// });

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
  console.log(
    "At the time of receiving an election request, my details are: " +
      JSON.stringify(node)
  );
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

  node.isElectionOngoing = false;
  if (node.masterNodeId > masterId) {
    console.log(
      `Node ID ${node.nodeId} says that master is already decided. Master node ID is : ${node.masterNodeId} and the ultimate bully.`
    );
    res
      .status(200)
      .send(`Node ${node.nodeId} rejects the master announcement.`);
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

  console.log(
    `Node ID ${node.nodeId} says that Master announcement has been made. Master node ID is : ${node.masterNodeId} and the ultimate bully.`
  );
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
