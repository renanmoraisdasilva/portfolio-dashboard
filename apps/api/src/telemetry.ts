import { format } from 'node:util';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import dotenv from 'dotenv';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

dotenv.config();

const enabled = process.env.OTEL_SDK_DISABLED !== 'true';

if (enabled) {
  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'portfolio-web';
  const tracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? 'http://host.docker.internal:4318/v1/traces';
  const metricsEndpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? 'http://host.docker.internal:4318/v1/metrics';
  const logsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? 'http://host.docker.internal:4318/v1/logs';

  const exporter = new OTLPTraceExporter({
    url: tracesEndpoint,
  });

  const sdk = new NodeSDK({
    serviceName,
    traceExporter: exporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: metricsEndpoint }),
      exportIntervalMillis: 60000,
    }),
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: logsEndpoint }) })],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const logger = logs.getLogger(serviceName);
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const emitConsoleLog = (method: keyof typeof originalConsole, severityNumber: SeverityNumber, args: unknown[]) => {
    originalConsole[method](...args);
    logger.emit({
      severityNumber,
      severityText: method.toUpperCase(),
      body: format(...args),
    });
  };

  console.log = (...args: unknown[]) => emitConsoleLog('log', SeverityNumber.INFO, args);
  console.info = (...args: unknown[]) => emitConsoleLog('info', SeverityNumber.INFO, args);
  console.warn = (...args: unknown[]) => emitConsoleLog('warn', SeverityNumber.WARN, args);
  console.error = (...args: unknown[]) => emitConsoleLog('error', SeverityNumber.ERROR, args);

  const shutdown = async () => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    try {
      await sdk.shutdown();
    } catch (error) {
      console.error('[otel] shutdown failed', error);
    }
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
