import express from "express";
import axios from "axios";

const sidecarProxy = express();

sidecarProxy.post("/proxy/:port/election", async (req, res) => {
  const targetPort = req.params.port;
  const { port } = req.body;
  try {
    const response = await axios.post(
      `http://localhost:${targetPort}/election`,
      { port }
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

sidecarProxy.get("/proxy/:port/node", async (req, res) => {
  const targetPort = req.params.port;
  try {
    const response = await axios.get(`http://localhost:${targetPort}/node`);
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error("Error in node details request:", error);
    res.status(500).send("Error forwarding request to main node");
  }
});

export default sidecarProxy;
