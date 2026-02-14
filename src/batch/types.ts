export interface BatchJob {
  jobId: string;
  sourceUrl: string;
  targetUrl: string;
  status: "pending" | "running" | "complete" | "error";
  progress: number;
  error?: string;
  reportId?: string;
}

export interface Batch {
  id: string;
  jobs: BatchJob[];
  status: "pending" | "running" | "complete" | "error";
  viewport: { width: number; height: number };
  createdAt: string;
  completedAt?: string;
  summaryReportId?: string;
}

export interface BatchMeta {
  id: string;
  status: string;
  viewport: { width: number; height: number };
  createdAt: string;
  completedAt?: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  summaryReportId?: string;
  jobs: {
    jobId: string;
    sourceUrl: string;
    targetUrl: string;
    status: string;
    progress: number;
    reportId?: string;
    error?: string;
  }[];
}
