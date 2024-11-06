const axios = require("axios");
const pdfParse = require("pdf-parse");
const admin = require("firebase-admin");
const fs = require("fs");
const cron = require("node-cron");

// Firebase Initialization
const serviceAccount = require("./sambad24-4cd0f-firebase-adminsdk-1vif3-c64539647b.json");
const { Timestamp } = require("firebase-admin/firestore");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const firestore = admin.firestore();

// Define URLs for different times of day
function getPdfUrls(currentDate) {
  //const formattedDate = currentDate.toISOString().slice(0, 10).replace(/-/g, "").slice(2); // "ddMMyy"
const day = String(currentDate.getDate()).padStart(2, '0'); // Get day and pad with leading zero if needed
const month = String(currentDate.getMonth() + 1).padStart(2, '0'); // Get month (0-based index, so add 1) and pad
const year = String(currentDate.getFullYear()).slice(2); // Get last two digits of the year

const formattedDate = `${day}${month}${year}`; // Concatenate to get ddMMyy

console.log(formattedDate); // Outputs: "031124" for 3rd November 2024

  return [
    { pdfUrl: `https://www.lotterysambad.com/fetchtoday.php?filename=MD${formattedDate}.PDF`, timeCode: "1pm" },
    { pdfUrl: `https://www.lotterysambad.com/fetchtoday.php?filename=DD${formattedDate}.PDF`, timeCode: "6pm" },
    { pdfUrl: `https://www.lotterysambad.com/fetchtoday.php?filename=ED${formattedDate}.PDF`, timeCode: "8pm" },
  ];
}

// Download PDF from URL
async function downloadPdf(url) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    console.log("Downloaded data size:", response.data.length); // Log the size of the downloaded data
    console.log("Downloaded data preview:", response.data.slice(0, 100)); // Log the first 100 bytes
    return response.data;
  } catch (error) {
    console.error(`Error downloading PDF: ${error.message}`);
    return null;
  }
}

// Function to extract prize data from the given content
function extractPrizeData(content) {
    const lines = content.split("\n");
    const prizes = {
      firstPrize: "",
      consolationPrize: "",
      secondPrizes: [],
      thirdPrizes: [],
      fourthPrizes: [],
      fifthPrizes: [],
    };
  
    lines.forEach((line) => {
        // Check for first prize (alphanumeric followed by 5-digit number)
        if (/^\d{2}[A-Z] \d{5}$/.test(line)) {
          prizes.firstPrize = line;
        }
        // Check for consolation prize (a single 5-digit number)
        else if (/^\d{5}$/.test(line)) {
          prizes.consolationPrize = line;
        }
        // Check for second prize (multiple 5-digit numbers)
        else if (/^(\d{5}\s+)+\d{5}$/.test(line)) {
          prizes.secondPrizes.push(line);
        }
        // Check for third prize (multiple 4-digit numbers, max 2)
        else if (/^(\d{4}\s+)+\d{4}$/.test(line) && prizes.thirdPrizes.length < 2) {
          prizes.thirdPrizes.push(line);
        }
        // Check for fourth prize (multiple 4-digit numbers, max 2, after third prizes)
        else if (/^(\d{4}\s+)+\d{4}$/.test(line) && prizes.thirdPrizes.length >= 2 && prizes.fourthPrizes.length < 2) {
          prizes.fourthPrizes.push(line);
        }
        // Check for fifth prize (multiple 4-digit numbers, max 3)
        else if (/^(?=.*\d)(\d{4}\s*)*$/.test(line) && prizes.fourthPrizes.length <= 2) {
          const separated = line && line.trim() !== "" ? line.match(/.{1,4}/g).join(' ') : '';
          prizes.fifthPrizes.push(separated);
        }
      });
      
  
    // Create an array similar to the C# return structure
    const result = [
      prizes.firstPrize,
      prizes.consolationPrize,
      prizes.secondPrizes.join(" "),
      prizes.thirdPrizes.join(" "),
      prizes.fourthPrizes.join(" "),
      prizes.fifthPrizes.join(" "),
    ];
  
    return result; // Return the result array
  }

// Save data to Firestore
async function saveToFirestore(collection, timeCode, data, currentDate) {
    const day = String(currentDate.getDate()).padStart(2, '0');
    const month = String(currentDate.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    const year = String(currentDate.getFullYear()).slice(-2); // Get the last two digits of the year
    const formattedDate = `${day}-${month}-${year}`; // Format date as yyyy-mm-dd
  const docRef = firestore.collection(collection).doc(formattedDate);
  const dataMap = { [timeCode]: data };

  try {
    await docRef.set(dataMap, { merge: true });
    console.log(`Data saved for ${timeCode} on ${formattedDate}`);
    await updateHomeData(currentDate); // Call UpdateHomeData after saving data
  } catch (error) {
    console.error(`Error saving to Firestore: ${error.message}`);
  }
}

async function updateHomeData(currentDate) {
    const documentId = "EWN5wQ20D4ahD0tGDNXR"; // Document ID
    const docRef = firestore.collection("HomeData").doc(documentId);

    try {
        // Fetch the document from Firestore
        const snapshot = await docRef.get();

        if (snapshot.exists) {
            // Extract the existing home_date1 array
            let homeDate1 = snapshot.data().home_date1 || [];

            // Format the current date as "dd-MM-yy"
            const formattedDate = formatDateToDDMMYY(currentDate);
            const currentTimestamp = admin.firestore.Timestamp.now(); // Get the current timestamp

            // Check if the current date is already present in the home_date1 array
            const dateExists = homeDate1.some(entry => entry.date === formattedDate);

            if (!dateExists) {
                // Add the current date and timestamp
                const newEntry = {
                    date: formattedDate,
                    dateTime: currentTimestamp // Store as ISO string for consistency
                };
                homeDate1.push(newEntry);
            }

            // Remove duplicates based on the "date" field
            const uniqueEntries = Array.from(new Map(homeDate1.map(item => [item.date, item])).values());

            // Limit the list to the most recent 15 items based on the dateTime field
            const recentEntries = uniqueEntries.sort((a, b) => new Date(b.dateTime.seconds) - new Date(a.dateTime.seconds)).slice(0, 15);

            // Update Firestore with the modified home_date1 array
            await docRef.set({ home_date1: recentEntries }, { merge: true });
            console.log("Home data updated successfully.");
        } else {
            console.log("Document does not exist.");
        }
    } catch (error) {
        console.error(`Error updating home data: ${error.message}`);
    }
}

// Utility function to format date as "dd-MM-yy"
function formatDateToDDMMYY(date) {
    const day = String(date.getDate()).padStart(2, '0'); // Ensure two digits
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Ensure two digits
    const year = String(date.getFullYear()).slice(-2); // Get last two digits of the year
    return `${day}-${month}-${year}`; // Format as "dd-MM-yy"
}


// Main processing function
async function processPdfData(pdfUrl, timeCode, currentDate) {
  let pdfData;

  // Step 1: Attempt to download PDF
  try {
    pdfData = await downloadPdf(pdfUrl);
    if (!pdfData) {
      console.error("PDF download failed: No data received.");
      return;
    }
    console.log("PDF downloaded successfully.");
  } catch (error) {
    console.error(`Error downloading PDF: ${error.message}`);
    return;
  }

  // Step 2: Attempt to parse PDF
  let pdfText;
  try {
    console.log("Attempting to parse the downloaded PDF...");
    pdfText = await pdfParse(pdfData);
    
    // Log raw pdfText for debugging purposes
    console.log("Raw PDF text:", pdfText.text);
    
    if (!pdfText || !pdfText.text || typeof pdfText.text !== 'string' || pdfText.text.trim() === '') {
      throw new Error("Parsed PDF has no readable text content.");
    }

    console.log("PDF parsed successfully.");
  } catch (error) {
    console.error(`Error parsing PDF data: ${error.message}`);
    return;
  }

  // Step 3: Extract prize data
  let prizes;
  try {
    prizes = extractPrizeData(pdfText.text);
    if (!prizes || Object.keys(prizes).length === 0) {
      throw new Error("No prize data found in PDF content.");
    }
    console.log(`Extracted prizes: ${JSON.stringify(prizes)}`);
  } catch (error) {
    console.error(`Error extracting prize data: ${error.message}`);
    return;
  }

  // Step 4: Save data to Firestore
  try {
    await saveToFirestore("Results", timeCode, prizes, currentDate);
    console.log(`Processed and saved data for ${timeCode}`);
  } catch (error) {
    console.error(`Error saving data to Firestore: ${error.message}`);
  }
}
// Schedule for 12:45 PM to 2 PM every 10 minutes
cron.schedule("*/10 12-13 * * *", async () => {
  const currentMinute = new Date().getMinutes();
  if (currentMinute >= 45 || currentMinute < 10) {  // Only trigger at 12:45-12:55 and 1:00-1:55
    console.log("Starting Lottery Data Processing (12:45 PM to 2 PM)...");
    await runLotteryDataProcessing();
    console.log("Lottery Data Processing Complete.");
  }
});

// Schedule for 5:45 PM to 9 PM every 10 minutes
cron.schedule("*/10 17-20 * * *", async () => {
  const currentMinute = new Date().getMinutes();
  if (currentMinute >= 45 || currentMinute < 10) {  // Only trigger at 5:45-5:55 and 6:00-8:55
    console.log("Starting Lottery Data Processing (5:45 PM to 9 PM)...");
    await runLotteryDataProcessing();
    console.log("Lottery Data Processing Complete.");
  }
});
// // Schedule the task every minute
// cron.schedule("*/1 * * * *", async () => {
//   console.log("Starting Lottery Data Processing...");
//   const currentDate = new Date();
//   currentDate.setDate(currentDate.getDate() - 1);

//   // const currentDate = new Date();
//   const pdfUrls = getPdfUrls(currentDate);

//   for (const { pdfUrl, timeCode } of pdfUrls) {
//     await processPdfData(pdfUrl, timeCode, currentDate);
//   }
//   console.log("Lottery Data Processing Complete.");
// });

// Start the cron job immediately on script execution
// (async () => {
//   console.log("Initial Lottery Data Processing...");
//   const currentDate = new Date();
//   currentDate.setDate(currentDate.getDate() - 1);
//   const pdfUrls = getPdfUrls(currentDate);

//   for (const { pdfUrl, timeCode } of pdfUrls) {
//     await processPdfData(pdfUrl, timeCode, currentDate);
//   }
//   console.log("Initial Lottery Data Processing Complete.");
// })();
