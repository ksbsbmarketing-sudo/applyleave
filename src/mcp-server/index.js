import admin from "firebase-admin";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "../../service-account-key.json");

let db;

async function initFirebase() {
  try {
    // Attempt 1: Look for the service account key file
    try {
      await fs.access(SERVICE_ACCOUNT_PATH);
      const serviceAccount = JSON.parse(await fs.readFile(SERVICE_ACCOUNT_PATH, "utf8"));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.error("Firebase initialized using service-account-key.json");
    } catch (keyErr) {
      // Attempt 2: Fallback to Application Default Credentials (ADC)
      console.error("Service account key not found, attempting fallback to Application Default Credentials...");
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: "apply-leave-89ebb" // Project ID is required for ADC fallback
      });
      console.error("Firebase initialized using Application Default Credentials (ADC)");
    }
    
    db = admin.firestore();
  } catch (err) {
    console.error(`\x1b[31mCritical Auth Error: ${err.message}\x1b[0m`);
    console.error("Please run: gcloud auth application-default login");
    process.exit(1);
  }
}

const server = new Server(
  {
    name: "ksb-leave-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Handler for listing available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_staff",
        description: "List all staff members and their basic information.",
        inputSchema: {
          type: "object",
          properties: {
            branch: {
              type: "string",
              description: "Filter staff by branch name (optional)",
            },
          },
        },
      },
      {
        name: "get_leave_records",
        description: "Get leave requests, optionally filtered by status or staff IC.",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["PENDING", "APPROVED", "REJECTED", "HOD APPROVED", "CANCELLED"],
              description: "Filter by status",
            },
            ic: {
              type: "string",
              description: "Filter by staff IC number",
            },
          },
        },
      },
      {
        name: "approve_leave",
        description: "Approve a pending leave request.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "The unique ID of the leave request to approve",
            },
            role: {
              type: "string",
              enum: ["admin", "hr", "super_admin", "hod"],
              description: "User role performing the approval (affects whether it is status 'APPROVED' or 'HOD APPROVED')",
            },
          },
          required: ["id", "role"],
        },
      },
    ],
  };
});

/**
 * Handler for tool execution.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "list_staff") {
      let queryRef = db.collection("staff");
      if (args?.branch) {
        queryRef = queryRef.where("branch", "==", args.branch);
      }
      const snapshot = await queryRef.get();
      const staff = snapshot.docs.map(doc => doc.data());
      return {
        content: [{ type: "text", text: JSON.stringify(staff, null, 2) }],
      };
    }

    if (name === "get_leave_records") {
      let queryRef = db.collection("leaves");
      if (args?.status) {
        queryRef = queryRef.where("status", "==", args.status);
      }
      if (args?.ic) {
        queryRef = queryRef.where("ic", "==", args.ic);
      }
      const snapshot = await queryRef.get();
      const leaves = snapshot.docs.map(doc => doc.data());
      return {
        content: [{ type: "text", text: JSON.stringify(leaves, null, 2) }],
      };
    }

    if (name === "approve_leave") {
      const { id, role } = z.object({
        id: z.number(),
        role: z.enum(["admin", "hr", "super_admin", "hod"])
      }).parse(args);

      const docRef = db.collection("leaves").doc(id.toString());
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        throw new Error(`Leave request with ID ${id} not found in Firestore.`);
      }

      const isFullBoss = ["admin", "hr", "super_admin"].includes(role);
      const newStatus = isFullBoss ? "APPROVED" : "HOD APPROVED";
      
      await docRef.update({ status: newStatus });

      return {
        content: [{ 
          type: "text", 
          text: `Successfully approved leave request #${id} in Firestore. New status: ${newStatus}` 
        }],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

/**
 * Start the server using stdio transport.
 */
async function main() {
  await initFirebase();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("KSB Leave MCP Server running on stdio (Syncing with Firestore)");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
