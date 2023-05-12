import axios from "axios";
const r = "abc";

export const sendPasswordToMaster = async (masterPort, password, nodeId) => {
  try {
    const response = await axios.post(
      `http://localhost:5000/proxy/${masterPort}/verify`,
      {
        password: password,
        nodeId: nodeId,
      }
    );

    console.log(nodeId + ": " + password);
    if (response.data.match) {
      // console.log(`Password match found inside SPTM: ${password}`);
      return;
    }
  } catch (error) {
    console.log(`Failed to send password to master node`);
    console.log(error);
  }
};
