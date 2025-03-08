const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mediasoup = require("mediasoup");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());

let worker, router;
let teacherSocketId = null;
const participants = {};

// Initialize Mediasoup
async function setupMediasoup() {
    worker = await mediasoup.createWorker();
    router = await worker.createRouter({
        mediaCodecs: [
            {
                kind: "video",
                mimeType: "video/VP8",
                clockRate: 90000,
                parameters: {},
            },
        ],
    });
}
setupMediasoup();

// Handle socket connections
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join", (role) => {
        if (role === "teacher") {
            teacherSocketId = socket.id;
        }
    });

    socket.on("getRouterRtpCapabilities", (rtpCapabilities, callback) => {
        callback(router.rtpCapabilities);
    });

    socket.on("createTransport", async (callback) => {
        const transport = await router.createWebRtcTransport({
            listenIps: [{ ip: "0.0.0.0", announcedIp: null }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
        });
        callback({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        });
    });

    socket.on("connectTransport", async ({ dtlsParameters }, callback, errback) => {
        try {
            await transport.connect({ dtlsParameters });
            callback();
        } catch (error) {
            errback(error);
        }
    });

    socket.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
        try {
            const producer = await transport.produce({ kind, rtpParameters });
            participants[socket.id] = producer;
            callback({ id: producer.id });
        } catch (error) {
            errback(error);
        }
    });

    socket.on("startScreenShare", ({ participantId, rtpParameters }) => {
        if (teacherSocketId) {
            io.to(teacherSocketId).emit("newStream", { participantId });
        }
    });

    socket.on("disconnectScreenShare", ({ participantId }) => {
        delete participants[participantId];
        if (teacherSocketId) {
            io.to(teacherSocketId).emit("participantDisconnected", { participantId });
        }
    });

    socket.on("disconnect", () => {
        delete participants[socket.id];
    });
});

server.listen(5000, "0.0.0.0", () => console.log("Server running on port 5000"));