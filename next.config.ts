import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @huggingface/transformers pulls in onnxruntime-node's native binary; keeping
  // it external (not bundled/minified by webpack) lets Next's file tracer find
  // and ship that binary alongside the function, the same treatment native deps
  // like sharp need on Vercel.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
