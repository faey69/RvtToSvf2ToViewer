let clientId = "";
let clientSecret = "";
let clientAuthKeys = "";
const bucketKey =
  "faey_rvt_to_svf2_to_viewer_bucket_key_" +
  Date.now() +
  "_" +
  performance.now().toString().replace(".", "");
console.log(bucketKey);
let objectKey = "";
const minutesExpiration = 60; // The expiration time in minutes for the URL
let urlSafeBase64EncodedUrn;
let accessToken;

async function getAccessToken() {
  console.log("Getting access token...");
  const url = "https://developer.api.autodesk.com/authentication/v2/token";
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "data:write data:read bucket:create bucket:delete",
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${clientAuthKeys}`,
      },
      body: params,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch token: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Access Token:", data.access_token);
    return data.access_token;
  } catch (error) {
    console.error("Error:", error);
  }
}

async function createBucket(accessToken) {
  if (!accessToken) {
    console.error("Access token not obtained, cannot create bucket");
    document.getElementById("fileInput").value = "";
    return;
  }

  const bucketData = {
    bucketKey: bucketKey,
    access: "full", // "full" or "read"
    policyKey: "transient", // or "persistent"
  };

  const url = "https://developer.api.autodesk.com/oss/v2/buckets";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "x-ads-region": "US", // Adjust region if needed
      },
      body: JSON.stringify(bucketData),
    });

    if (!response.ok) {
      throw new Error(`Failed to create bucket: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Bucket Created:", data);
  } catch (error) {
    console.error("Error:", error);
  }
}

// Function to Get Signed S3 Upload URL
async function getSignedS3UploadUrl(
  bucketKey,
  objectKey,
  accessToken,
  minutesExpiration
) {
  const uriEncodedObjectKey = encodeURIComponent(objectKey);
  const url = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${uriEncodedObjectKey}/signeds3upload?minutesExpiration=${minutesExpiration}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch signed URL: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Signed S3 Upload URL:", data);
    return data;
  } catch (error) {
    console.error("Error:", error);
  }
}

// Function to Upload the File to S3 using the Signed URL
async function uploadFileToSignedUrl(signedUrl, file) {
  try {
    const response = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type, // Set the appropriate content type
      },
      body: file, // The file object to be uploaded
    });

    if (!response.ok) {
      throw new Error(`Failed to upload file: ${response.statusText}`);
    }

    console.log("File uploaded successfully.");
  } catch (error) {
    console.error("Error uploading file:", error);
  }
}

async function finalizeUpload(accessToken, uploadKey) {
  const uriEncodedObjectKey = encodeURIComponent(objectKey); // URL-encode objectKey here
  const url = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${uriEncodedObjectKey}/signeds3upload`;

  const body = {
    ossbucketKey: bucketKey,
    ossSourceFileObjectKey: objectKey,
    access: "full", // Or the required level of access
    uploadKey: uploadKey,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to finalize upload: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Upload finalized:", data);

    // Extract and log the final raw URN (objectId)
    const rawUrn = data.objectId; // This should contain the raw URN
    console.log("Finalized Object URN:", rawUrn);
    return rawUrn;
  } catch (error) {
    console.error("Error finalizing upload:", error);
  }
}

// Function to Start the Model Derivative Job (Translation to SVF2)
async function startModelDerivativeJob(accessToken, urlSafeBase64EncodedUrn) {
  const url =
    "https://developer.api.autodesk.com/modelderivative/v2/designdata/job";
  const body = {
    input: {
      urn: urlSafeBase64EncodedUrn,
    },
    output: {
      formats: [
        {
          type: "svf2",
          views: ["2d", "3d"],
          advanced: {
            generateMasterViews: true,
          },
        },
      ],
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "x-ads-force": "true",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to start model derivative job: ${response.statusText}`
      );
    }

    const data = await response.json();
    console.log("Model Derivative Job Started:", data);
    return data;
  } catch (error) {
    console.error("Error starting model derivative job:", error);
  }
}

// It returns string that is URL-safe, but does not encode to URL
function urlSafeBase64Encode(str) {
  return btoa(str) // Base64 encode the URN
    .replace(/\+/g, "-") // Replace '+' with '-'
    .replace(/\//g, "_") // Replace '/' with '_'
    .replace(/=+$/, ""); // Remove padding '='
}

// File Input Event Listener
document
  .getElementById("fileInput")
  .addEventListener("change", async (event) => {
    const file = event.target.files[0];

    if (file) {
      console.log("Selected file:", file);
      setup();
      objectKey = file.name;

      (async () => {
        // Wait for Access Token
        while (!accessToken) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        // Get signed upload URL and upload key
        const signedUploadUrlData = await getSignedS3UploadUrl(
          bucketKey,
          objectKey,
          accessToken,
          minutesExpiration
        );

        if (signedUploadUrlData) {
          // Destructure signedUrl and uploadKey from the response data
          const { uploadKey, urls } = signedUploadUrlData;
          const signedUrl = urls && urls[0]; // Assuming the response contains a list of URLs

          console.log("Signed URL:", signedUrl);
          console.log("Upload Key:", uploadKey);

          if (signedUrl) {
            // Upload file to the signed URL
            await uploadFileToSignedUrl(signedUrl, file);

            // Finalize the upload using the uploadKey
            const rawUrn = await finalizeUpload(accessToken, uploadKey);

            urlSafeBase64EncodedUrn = urlSafeBase64Encode(rawUrn);
            console.log(
              "URL-safe Base64 Encoded URN:",
              urlSafeBase64EncodedUrn
            );

            // Start the model derivative job
            const jobResult = await startModelDerivativeJob(
              accessToken,
              urlSafeBase64EncodedUrn
            );
            console.log("Model Derivative Job Result:", jobResult);
          }
        }
      })();
    }
  });

async function setup() {
  console.log("executing script");
  clientId = document.getElementById("clientId").value;
  clientSecret = document.getElementById("clientSecret").value;
  clientAuthKeys = btoa(clientId + ":" + clientSecret);
  accessToken = await getAccessToken();
  await createBucket(accessToken);
}

// ---------- Check Translation Status ----------
// Function to Check the Translation Job Status and Initialize the Viewer
async function checkAndDisplayViewer(urlSafeBase64EncodedUrn, accessToken) {
  const url = `https://developer.api.autodesk.com/modelderivative/v2/designdata/${urlSafeBase64EncodedUrn}/manifest`;
  console.log(
    "Checking status for urlSafeBase64EncodedUrn:",
    urlSafeBase64EncodedUrn
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to check status: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Manifest response:", data);

    const status = data.status;
    const resultElement = document.getElementById("statusResult");

    switch (status) {
      case "pending":
        resultElement.textContent = "Translation job is pending.";
        break;
      case "inprogress":
        resultElement.textContent = "Translation job is in progress.";
        break;
      case "success":
        resultElement.textContent = "Translation job completed successfully!";
        loadForgeViewer(urlSafeBase64EncodedUrn, accessToken);
        break;
      case "failed":
        resultElement.textContent = "Translation job failed.";
        break;
      case "timeout":
        resultElement.textContent = "Translation job timed out.";
        break;
      default:
        resultElement.textContent = "Unknown status.";
    }
  } catch (error) {
    console.error("Error checking translation status:", error);
    document.getElementById("statusResult").textContent =
      "Error checking status.";
  }
}

// Function to Initialize the Forge Viewer with the SVF2 model
function loadForgeViewer(urlSafeBase64EncodedUrn, accessToken) {
  const options = {
    env: "AutodeskProduction2", // Viewer environment (use AutodeskProduction2 for SVF2)
    api: "streamingV2", // API type (for EMEA, use 'streamingV2_EU')
    getAccessToken: function (onTokenReady) {
      // Provide the access token for Viewer
      const token = accessToken;
      const timeInSeconds = 3600; // Token expiration time
      onTokenReady(token, timeInSeconds);
    },
  };

  let viewer; // Viewer instance

  Autodesk.Viewing.Initializer(options, function () {
    const htmlDiv = document.getElementById("forgeViewer");
    viewer = new Autodesk.Viewing.GuiViewer3D(htmlDiv);

    const startedCode = viewer.start();
    if (startedCode > 0) {
      console.error(
        "Failed to create a Viewer: WebGL not supported or disabled."
      );
      return;
    }

    console.log("Viewer initialized. Loading model...");

    const documentId = `urn:${urlSafeBase64EncodedUrn}`;
    Autodesk.Viewing.Document.load(
      documentId,
      function (doc) {
        onDocumentLoadSuccess(doc, viewer);
      },
      onDocumentLoadFailure
    );
  });

  // Success Callback - When the document is successfully loaded
  function onDocumentLoadSuccess(viewerDocument, viewer) {
    console.log("Manifest fetched successfully");

    // Get default viewable geometry from document
    const defaultModel = viewerDocument.getRoot().getDefaultGeometry();

    // Load viewable node into the Viewer
    viewer.loadDocumentNode(viewerDocument, defaultModel).then(() => {
      console.log("Model loaded successfully.");
    });
  }

  // Failure Callback - When fetching document manifest fails
  function onDocumentLoadFailure(error) {
    console.error("Failed to fetch document manifest", error);
  }
}

document
  .getElementById("checkStatusBtn")
  .addEventListener("click", async () => {
    if (urlSafeBase64EncodedUrn) {
      checkAndDisplayViewer(urlSafeBase64EncodedUrn, accessToken);
    } else {
      document.getElementById("statusResult").textContent =
        "No URN available for checking status.";
    }
  });
