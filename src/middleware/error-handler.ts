import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    app.log.error(
      { err: error, url: request.url, method: request.method },
      "Request error"
    );

    if (error.validation) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Validation error",
        details: error.validation,
      });
    }

    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal Server Error" : error.message,
      message:
        config.NODE_ENV === "development"
          ? error.message
          : "An unexpected error occurred",
    });
  });
}
