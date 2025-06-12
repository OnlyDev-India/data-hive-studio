import React from 'react';
import { motion } from 'framer-motion';

interface QueryExecutingAnimationProps {
  className?: string;
  size?: number;
}

const QueryExecutingAnimation: React.FC<QueryExecutingAnimationProps> = ({ 
  className = "", 
  size = 48 
}) => {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 56 56"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Central loading circle with rotating segments */}
        <motion.g style={{ transformOrigin: '28px 28px' }}>
          {/* Background circle */}
          <circle
            cx="28"
            cy="28"
            r="18"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            className="text-secondary opacity-30"
          />
          
          {/* Animated segments */}
          <motion.circle
            cx="28"
            cy="28"
            r="18"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeDasharray="30 70"
            className="text-primary"
            animate={{ rotate: 360 }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "linear"
            }}
          />
          
          <motion.circle
            cx="28"
            cy="28"
            r="18"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeDasharray="20 80"
            className="text-primary opacity-60"
            animate={{ rotate: -360 }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "linear"
            }}
          />
        </motion.g>

        {/* Central database icon */}
        <motion.g
          animate={{
            scale: [1, 1.1, 1],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        >
          {/* Database server icon */}
          <rect
            x="22"
            y="20"
            width="12"
            height="16"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
            fill="currentColor"
            fillOpacity="0.1"
            className="text-primary"
          />
          
          {/* Server layers */}
          <line
            x1="22"
            y1="24"
            x2="34"
            y2="24"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-primary opacity-70"
          />
          <line
            x1="22"
            y1="28"
            x2="34"
            y2="28"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-primary opacity-70"
          />
          <line
            x1="22"
            y1="32"
            x2="34"
            y2="32"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-primary opacity-70"
          />
          
          {/* Power indicator */}
          <motion.circle
            cx="25"
            cy="22"
            r="1"
            fill="currentColor"
            className="text-primary"
            animate={{
              opacity: [0.5, 1, 0.5],
              scale: [0.8, 1.2, 0.8]
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity
            }}
          />
        </motion.g>

        {/* Data flow particles */}
        <motion.g>
          {[...Array(8)].map((_, i) => (
            <motion.circle
              key={i}
              cx={28 + Math.cos((i * Math.PI * 2) / 8) * 24}
              cy={28 + Math.sin((i * Math.PI * 2) / 8) * 24}
              r="1.5"
              fill="currentColor"
              className={i % 3 === 0 ? "text-primary" : i % 3 === 1 ? "text-primary opacity-70" : "text-primary opacity-50"}
              animate={{
                scale: [0, 1, 0],
                opacity: [0, 1, 0]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                delay: i * 0.2
              }}
            />
          ))}
        </motion.g>

        {/* Query text indicator */}
        <motion.g
          animate={{
            opacity: [0.5, 1, 0.5]
          }}
          transition={{
            duration: 2,
            repeat: Infinity
          }}
        >
          <text
            x="28"
            y="8"
            fontSize="6"
            fill="currentColor"
            className="text-muted-foreground font-mono"
            textAnchor="middle"
          >
            QUERY
          </text>
        </motion.g>
      </svg>

      {/* Loading text with typewriter effect */}
      <motion.div
        className="text-sm text-muted-foreground font-medium"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <motion.span
          animate={{
            opacity: [1, 0.5, 1]
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity
          }}
        >
          Executing query
        </motion.span>
        <motion.span
          animate={{
            opacity: [0, 1, 0]
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            repeatDelay: 0.5
          }}
        >
          ...
        </motion.span>
      </motion.div>

      {/* Progress indicator */}
      <div className="w-32 h-1 bg-secondary rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary rounded-full"
          animate={{
            x: ['-100%', '100%']
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
      </div>
    </div>
  );
};

export default QueryExecutingAnimation; 