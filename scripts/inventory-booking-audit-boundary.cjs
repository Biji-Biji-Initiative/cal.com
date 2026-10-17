// SPDX-License-Identifier: MIT
const fs = require("node:fs");
const path = require("node:path");

const CODE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);
const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);

function walk(dir, root, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, root, files);
    else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push({ absolute, relative: path.relative(root, absolute).split(path.sep).join("/") });
    }
  }
  return files;
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function inventory(root) {
  const producerPath = "packages/features/booking-audit/lib/service/BookingAuditTaskerProducerService.ts";
  const consumerPath = "packages/features/booking-audit/lib/service/BookingAuditTaskConsumer.ts";
  const repositoryPath = "packages/features/booking-audit/lib/repository/PrismaBookingAuditRepository.ts";
  const taskRepositoryPath = "packages/features/tasker/repository.ts";
  const interfacePath =
    "packages/features/booking-audit/lib/service/BookingAuditProducerService.interface.ts";
  const schemaPath = "packages/prisma/schema.prisma";
  const readmePath = "packages/features/booking-audit/README.md";
  const accessPath = "packages/features/booking-audit/lib/service/BookingAuditAccessService.ts";
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
  const producer = read(producerPath);
  const consumer = read(consumerPath);
  const repository = read(repositoryPath);
  const taskRepository = read(taskRepositoryPath);
  const serviceInterface = read(interfacePath);
  const schema = read(schemaPath);
  const readme = read(readmePath);
  const access = read(accessPath);
  const files = walk(path.join(root, "packages"), root).concat(walk(path.join(root, "apps"), root));

  const productionCallsites = files
    .filter(({ relative }) => !relative.startsWith("packages/features/booking-audit/"))
    .filter(({ absolute }) => {
      const source = fs.readFileSync(absolute, "utf8");
      return /BookingAuditProducerService|getBookingAuditProducerService|queue(?:Created|Cancelled|Rescheduled|Accepted|Rejected|Attendee|NoShow|Reassignment|Location|Seat).*Audit/.test(
        source
      );
    })
    .map(({ relative }) => relative);

  const retentionCode = files
    .filter(
      ({ relative }) =>
        !relative.includes("/test") &&
        !relative.includes("/__tests__/") &&
        !relative.includes("migrations/") &&
        !relative.startsWith("packages/prisma/generated/")
    )
    .filter(({ absolute }) =>
      /bookingAudit\.(?:delete|deleteMany|update|updateMany)|BookingAudit.*(?:retention|anonymi)/i.test(
        fs.readFileSync(absolute, "utf8")
      )
    )
    .map(({ relative }) => relative);

  const taskCreationLines = producer
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter(({ text }) => /this\.tasker\.create\("bookingAudit"/.test(text))
    .map(({ line }) => line);

  const bookingAuditModel = schema.match(/model BookingAudit\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";

  return {
    files: {
      producerPath,
      consumerPath,
      repositoryPath,
      taskRepositoryPath,
      interfacePath,
      schemaPath,
      readmePath,
      accessPath,
    },
    producer: {
      taskCreateCalls: taskCreationLines.length,
      taskCreateLines: taskCreationLines,
      catchesQueueErrors: /catch \(error\)[\s\S]{0,280}this\.log\.error/.test(producer),
      declaresTransactionDependency: /transaction|TransactionClient/.test(
        producer.split("private async queueTask")[0]
      ),
      passesTaskReferenceUid: /referenceUid\s*:/.test(producer),
      piiFreeActorBeforeQueue:
        producer.indexOf("getPIIFreeBookingAuditActor") <
        producer.indexOf('this.tasker.create("bookingAudit"'),
      actorMaterializationBeforeQueue:
        producer.indexOf("getPIIFreeBookingAuditActor") <
        producer.indexOf('this.tasker.create("bookingAudit"'),
    },
    consumer: {
      repositoryCreateCalls: countMatches(consumer, /bookingAuditRepository\.create(?:Many)?\(/g),
      usesTaskPayloadUpdateOnMigration: consumer.includes("Task.updatePayload"),
      writesBookingAuditInConsumer: consumer.includes("this.bookingAuditRepository.create("),
    },
    repository: {
      createCallsPrisma: countMatches(repository, /prismaClient\.bookingAudit\.create(?:Many)?\(/g),
      hasOperationIdIndexOnly: repository.includes("operationId: bookingAudit.operationId"),
    },
    tasker: {
      taskModelHasReferenceUidUnique:
        taskRepository.includes("referenceUid") && taskRepository.includes("type"),
      taskModelSupportsTransactionClient: false,
    },
    schema: {
      auditActorHasPseudonymizedAt: /model AuditActor[\s\S]*?pseudonymizedAt/.test(
        schema.match(/model AuditActor\s*\{([\s\S]*?)^\}/m)?.[1] ?? ""
      ),
      bookingAuditOperationIdIndexed: /@@index\(\[operationId\]\)/.test(bookingAuditModel),
      bookingAuditOperationIdUnique: /operationId[^\n]*@unique/.test(bookingAuditModel),
    },
    documentation: {
      readmeClaimsPseudonymization: /anonymi|pseudonym/i.test(readme),
    },
    access: {
      organizationIdReferences: countMatches(access, /organizationId/g),
      ownerOnlyCheck: access.includes("bookingOwnerId === userId"),
      adminOnlyComment: /admin-only for compliance and security purposes/i.test(access),
    },
    wiring: {
      productionCallsites,
      retentionCode,
    },
    interface: {
      queueMethods: countMatches(serviceInterface, /^\s+queue[A-Z][A-Za-z]+\(/gm),
    },
  };
}

if (require.main === module) {
  const report = inventory(path.resolve(__dirname, ".."));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { inventory };
