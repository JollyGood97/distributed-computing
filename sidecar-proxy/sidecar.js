import express from "express";
import axios from "axios";

const sidecarProxy = express();

sidecarProxy.use(express.json());

sidecarProxy.get("/proxy/:port/node", async (req, res) => {
  const targetPort = req.params.port;
  try {
    const response = await axios.get(`http://localhost:${targetPort}/node`);
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error("Error fetching node details:", error);
    res.status(500).send("Error forwarding request to node");
  }
});

sidecarProxy.post("/proxy/:port/election", async (req, res) => {
  const targetPort = req.params.port;
  console.log(`Received election request for port ${targetPort}`);

  try {
    const response = await axios.post(
      `http://localhost:${targetPort}/election`
    );
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error("Error sending election request:", error);
    res.status(500).send("Error forwarding election request to node");
  }
});

sidecarProxy.post("/proxy/:port/master", async (req, res) => {
  const targetPort = req.params.port;
  const { masterId } = req.body;
  console.log(
    `Sending master Id ${masterId} announcement to port` + targetPort
  );
  try {
    const response = await axios.post(`http://localhost:${targetPort}/master`, {
      masterId,
    });
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error("Error sending master announcement:", error);
    res.status(500).send("Error forwarding master announcement to node");
  }
});

sidecarProxy.post(
  "/proxy/:port/master-announcement-received",
  async (req, res) => {
    const targetPort = req.params.port;
    try {
      const response = await axios.post(
        `http://localhost:${targetPort}/master-announcement-received`
      );
      res.status(response.status).send(response.data);
    } catch (error) {
      console.error("Error forwarding master announcement received:", error);
      res
        .status(500)
        .send("Error forwarding master announcement received to node");
    }
  }
);

sidecarProxy.post("/proxy/:port/update-stop", async (req, res) => {
  const targetPort = req.params.port;
  const { stop } = req.body;
  console.log(
    "Resetting stop and wait status for slave node on port " + targetPort
  );
  try {
    const response = await axios.post(
      `http://localhost:${targetPort}/update-stop`,
      { stop }
    );
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error("Error forwarding update stop request:", error);
    res.status(500).send("Error forwarding update stop request to node");
  }
});

sidecarProxy.post("/proxy/:port/workload", async (req, res) => {
  const targetPort = req.params.port;
  const { range, round, port } = req.body;

  console.log("workload for line", round);
  console.log(`Sending workload to node on port ${port}: ${range}`);

  try {
    const response = await axios.post(
      `http://localhost:${targetPort}/workload`,
      { range, round, port }
    );
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error("Error forwarding workload request:", error);
    res.status(500).send("Error forwarding workload request to node");
  }
});

sidecarProxy.post("/proxy/:port/completion", async (req, res) => {
  const targetPort = req.params.port;
  const { message } = req.body;

  console.log("Sending completetion message: " + message + " to " + targetPort);
  try {
    const response = await axios.post(
      `http://localhost:${targetPort}/completion`,
      { message }
    );
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error("Error forwarding completion message:", error);
    res.status(500).send("Error forwarding completion message to node");
  }
});

sidecarProxy.post("/proxy/:port/verify", async (req, res) => {
  const targetPort = req.params.port;
  const { password, nodeId } = req.body;

  try {
    const response = await axios.post(`http://localhost:${targetPort}/verify`, {
      password,
      nodeId,
    });
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error("Error sending verify request:", error);
    res.status(500).send("Error forwarding verify request to node");
  }
});

sidecarProxy.post("/proxy/:port/end", async (req, res) => {
  const targetPort = req.params.port;
  console.log(
    `Password cracking is finally over slave! ${targetPort}, You are free now!`
  );
  try {
    const response = await axios.post(`http://localhost:${targetPort}/end`);
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error("Error sending end request:", error);
    res.status(500).send("Error forwarding end request to node");
  }
});

const PORT = 5000;

sidecarProxy.listen(PORT, () => {
  console.log(`Sidecar Proxy running on port ${PORT}`);
});
