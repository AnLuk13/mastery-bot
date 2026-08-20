import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @huggingface/transformers pulls in onnxruntime-node's native binary; keeping
  // it external (not bundled/minified by webpack) lets Next's file tracer find
  // and ship that binary alongside the function, the same treatment native deps
  // like sharp need on Vercel.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  // serverExternalPackages alone isn't enough: onnxruntime_binding.node loads
  // libonnxruntime.so.1 via dlopen at the OS level, which Vercel's static file
  // tracer can't see, so it's silently dropped from the deployed function
  // unless force-included here. Vercel's Node.js runtime is linux/x64. Both
  // API routes need this: /api/telegram/setup also imports the bot (to reach
  // Telegram's API), and createBot()'s askDeps pull in embeddingModel.ts —
  // which imports @huggingface/transformers — even though setup never
  // actually calls embedText() at runtime.
  outputFileTracingIncludes: {
    "/api/telegram/**": [
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
    ],
  },
};

export default nextConfig;
