// SPDX-License-Identifier: MIT
// Loopback-only acceptance sink: never relays mail or opens an external connection.
const net = require("node:net");
const assert = require("node:assert/strict");
async function startSmtpTestSink() {
  const messages = [];
  const clients = new Set();
  const permitted = new Set(["smoke@example.test", "invitee@example.test"]);
  const server = net.createServer((socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => {});
    socket.setTimeout(30000, () => socket.destroy());
    let buffer = "",
      recipients = [],
      content = [],
      inData = false,
      size = 0;
    socket.write("220 localhost synthetic SMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.length + size > 2000000) {
        socket.destroy();
        return;
      }
      let end;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            const raw = content.join("\r\n");
            const subject = (raw.match(/^Subject:\s*([^\r\n]*(?:\r\n[ \t]+[^\r\n]*)*)/im)?.[1] ?? "").replace(
              /\r\n[ \t]+/g,
              " "
            );
            messages.push({ recipients: [...recipients], subject, bytes: Buffer.byteLength(raw) });
            recipients = [];
            content = [];
            size = 0;
            inData = false;
            socket.write("250 accepted by isolated test sink\r\n");
          } else {
            content.push(line.startsWith("..") ? line.slice(1) : line);
            size += line.length;
          }
          continue;
        }
        const command = line.split(" ", 1)[0].toUpperCase();
        if (command === "EHLO" || command === "HELO") socket.write("250-localhost\r\n250 8BITMIME\r\n");
        else if (command === "MAIL") {
          recipients = [];
          socket.write("250 sender accepted\r\n");
        } else if (command === "RCPT") {
          const address = line.match(/TO:\s*<([^>]+)>/i)?.[1]?.toLowerCase();
          if (!permitted.has(address)) socket.write("550 only synthetic recipients accepted\r\n");
          else {
            recipients.push(address);
            socket.write("250 recipient accepted\r\n");
          }
        } else if (command === "DATA" && recipients.length) {
          inData = true;
          socket.write("354 end with dot\r\n");
        } else if (command === "QUIT") socket.end("221 closing\r\n");
        else if (command === "RSET") {
          recipients = [];
          socket.write("250 reset\r\n");
        } else if (command === "NOOP") socket.write("250 ok\r\n");
        else socket.write("502 not supported by test sink\r\n");
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    environment: {
      EMAIL_FROM: "notifications@example.test",
      EMAIL_SERVER_HOST: "127.0.0.1",
      EMAIL_SERVER_PORT: String(server.address().port),
    },
    count: () => messages.length,
    async expectDeliverySince(index, phase) {
      const deadline = Date.now() + 15000;
      const matches = (message) =>
        message.subject.toLowerCase().includes("preview advisory call") &&
        (phase === "rescheduled"
          ? /reschedul/i.test(message.subject)
          : phase === "cancelled"
            ? /cancel/i.test(message.subject)
            : !/reschedul|cancel/i.test(message.subject));
      while (Date.now() < deadline) {
        const found = new Set(
          messages
            .slice(index)
            .filter(matches)
            .flatMap((message) => message.recipients)
        );
        if ([...permitted].every((recipient) => found.has(recipient))) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.fail(
        `Missing ${phase} notification to synthetic organizer/invitee; captured subjects: ${JSON.stringify(messages.slice(index).map((message) => message.subject))}`
      );
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of clients) socket.destroy();
        server.close(resolve);
      }),
  };
}
module.exports = { startSmtpTestSink };
