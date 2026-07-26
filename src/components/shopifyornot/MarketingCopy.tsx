"use client";

import React from "react";
import { motion } from "framer-motion";

export default function MarketingCopy() {
    return (
        <motion.div
            className="text-center mt-6 max-w-sm mx-auto"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
        >
            <motion.p
                className="text-[11px] md:text-[13px] text-[#666666] leading-relaxed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.4 }}
            >
                If you sell to Shopify merchants,{" "}
                <span className="font-semibold text-[#D72C0D]">not every website</span> in your lead
                list is actually a Shopify store. Your sales team wastes atleast{" "}
                <span className="font-bold text-[#008060] bg-[#E6F7F1] px-1 py-0.5 rounded">
                    21hrs/week
                </span>{" "}
                qualifying leads manually — let's eliminate that.
            </motion.p>
        </motion.div>
    );
}
