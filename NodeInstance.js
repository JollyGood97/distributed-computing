import * as dotenv from "dotenv";
import { generateNodeId } from "./bullyUtils.js";

dotenv.config();

class NodeInstance {
  constructor(nodeId, port, isElectionOngoing, isMaster, masterNodeId) {
    this.nodeId = nodeId;
    this.port = port;
    this.isElectionOngoing = isElectionOngoing;
    this.isMaster = isMaster;
    this.masterNodeId = masterNodeId;
  }
}

const port = process.env.PORT || 3000;
const nodeId = generateNodeId();
const node = new NodeInstance(nodeId, port, false, false, undefined);

export { node, NodeInstance };
