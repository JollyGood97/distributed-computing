import axios from "axios";
import * as fs from "fs";

// 62 chars
const CHAR_SET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const divideWorkload = (nodes) => {
  const totalNodes = nodes.length;
  const workload = {};

  for (let i = 0; i < totalNodes; i++) {
    const offset = Math.floor(CHAR_SET.length / totalNodes) * i;
    const shiftedCharSet = CHAR_SET.slice(offset) + CHAR_SET.slice(0, offset);
    workload[nodes[i].nodeId] = shiftedCharSet;
  }
  console.log(workload);
  return workload;
};

export const sendWorkload = async (
  port,
  assignedRange,
  currentPasswordIndex,
  shouldStop
) => {
  await axios.post(`http://localhost:${port}/update-stop`, { stop: false });

  try {
    console.log("workload sending in round ", currentPasswordIndex);
    console.log(`Workload sending to node on port ${port}: ${assignedRange}`);
    const response = await axios.post(`http://localhost:${port}/workload`, {
      range: assignedRange,
      round: currentPasswordIndex,
      port: port,
    });
  } catch (error) {
    console.log(`Failed to send workload to node on port ${port}`);
    console.log(error);
  }
};

export const readPasswordFile = (filename) => {
  const data = fs.readFileSync(filename, "utf-8");
  return data.split(/\r?\n/).filter((line) => line.trim() !== "");
};

export const sendCompletionMessage = async (nodes, match) => {
  const message = match ? "passwordMatch" : "nextPassword";

  for (const node of nodes) {
    if (!node.isMaster) {
      try {
        const response = await axios.post(
          `http://localhost:${node.port}/completion`,
          { message }
        );
      } catch (error) {
        console.log(
          `Failed to send completion message to node on port ${node.port}`
        );
        console.log(error);
      }
    }
  }
};
