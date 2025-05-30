"use client"; // Add this - required for useState and event handlers
import Image from "next/image";
import { useState } from "react";

export default function Home() {
  const [message, setMessage] = useState("Nothing");

  const handleClick = async () => {
    // Add async here
    try {
      const response = await fetch("/api/test");
      const data = await response.json(); // Parse JSON
      setMessage(data.message); // Update state with the message
    } catch (error) {
      console.error("Error:", error);
      setMessage("Error fetching data");
    }
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
        <div>{message}</div>

        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <button // Changed from Button to button
            className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background gap-2 hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 sm:w-auto"
            onClick={handleClick} // Remove arrow function wrapper
          >
            Test API
          </button>
        </div>
      </main>
    </div>
  );
}
