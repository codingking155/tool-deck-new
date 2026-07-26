'use client';

import React from 'react';
import { motion } from 'framer-motion';

type ErrorAlertProps = {
  message: string;
};

export default function ErrorAlert({ message }: ErrorAlertProps) {
  return (
    <motion.div
      className="max-w-2xl mx-auto mt-6"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="p-4 bg-[#FFF0ED] border border-[#E34850] rounded-lg">
        <p className="text-[#D72C0D] font-medium">{message}</p>
      </div>
    </motion.div>
  );
}

