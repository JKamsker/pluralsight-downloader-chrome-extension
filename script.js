// Cancellationtoken
const CANCEL = Symbol();

class CancellationToken {

	constructor() {
		this.cancelled = false;
	}

	throwIfCancelled() {
		if (this.isCancelled()) {
			throw "Cancelled!";
		}
	}

	isCancelled() {
		return this.cancelled === true;
	}

	[CANCEL]() {
		this.cancelled = true;
	}

	// could probably do with a `register(func)` method too for cancellation callbacks

}

class CancellationTokenSource {

	constructor() {
		this.token = new CancellationToken();
	}

	cancel() {
		this.token[CANCEL]();
	}

}

// =================================================================
// START:VARIABLES
// =================================================================

const APPNAME = 'PluralsightCourseDownloader'
const ROOT_DIRECTORY = 'PluralsightCourseDownloader'

const INVALID_CHARACTERS = /[\/:?><]/g
const DELIMINATOR = '.'
const EXTENSION = 'mp4'
const EXTENSION_SUBS = 'smi'

const qualities = ["1280x720", "1024x768"]
const DEFAULT_QUALITY = qualities[0]

const DOWNLOAD_TIMEOUT = 5000
let DURATION_PERCENT = 10		// percent max 100


// videoURL to get the actual video URL
const viewclipURL = "https://app.pluralsight.com/video/clips/v3/viewclip";
const subsURL = "https://app.pluralsight.com/transcript/api/v1/caption/webvtt"

// STATE variables
let EXTENSION_ENABLED = false
let CONTINUE_DOWNLOAD = true
let DOWNLOADING = false

let CANCELLATION_TOKEN;

// =================================================================
// END:VARIABLES
// =================================================================




// ====================================================================
// START:UTILITIES
// ====================================================================
const sleep = ms =>
	new Promise((resolve) => setTimeout(resolve, ms));


const log = (message, type = "STATUS") =>
	console.log(`[${APPNAME}]:[${type}]: ${message}`);


const removeInvalidCharacters = name =>
	name.replace(INVALID_CHARACTERS, " ")
		.trim();


const sendMessageToPopup = (messageId, messageData) => {

	// chrome.runtime.sendMessage({ target: "popup", "message": messageId, "data": messageData }, function (response) {
	// 	console.dir(response);
	// });

	// chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
	// 	var activeTab = tabs[0];
	// 	chrome.tabs.sendMessage(activeTab.id, { target: "popup", "message": messageId, "data": messageData });
	// });
}

// ====================================================================
// END:UTILITIES
// ====================================================================



const getDirectoryName = (sectionIndex, sectionName) =>
	removeInvalidCharacters(`${sectionIndex + 1}${DELIMINATOR} ${sectionName}`);

const getFileName = (videoIndex, videoName) =>
	removeInvalidCharacters(`${videoIndex + 1}${DELIMINATOR} ${videoName}`);


const getVideoURL = async (videoId) => {
	try {
		const response = await fetch(viewclipURL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				clipId: videoId,
				mediaType: EXTENSION,
				quality: DEFAULT_QUALITY,
				online: true,
				boundedContext: "course",
				versionId: "",
			}),
		});

		const json = await response.json();
		return json.urls[0].url;

	} catch (error) {
		return error;
	}
};

const getSubtitleURL = async (videoId, versionId) => {

	return subsURL + "/" + videoId + "/" + versionId + "/en/";
}

const getFilePath = async (
	courseName,
	authorName,
	sectionIndex,
	sectionName,
	videoIndex,
	videoName,
	extension
) => {
	try {
		const rootDirectory = ROOT_DIRECTORY
		const courseDirectory = (
			authorName !== undefined ?
				`${courseName} By ${authorName}`.trim() :
				`${courseName}`.trim()
		)
		const sectionDirectory = getDirectoryName(sectionIndex, sectionName);
		const fileName = getFileName(videoIndex, videoName);

		const filePath = `${rootDirectory}\\${courseDirectory}\\${sectionDirectory}\\${fileName}.${extension}`;


		return filePath.replace(/(\r\n|\n|\r)/gm, "");
	} catch (error) {
		return error;
	}
};


const downloadVideo = async (videoURL, filePath) => {
	try {
		chrome.runtime.sendMessage({
			action: "download-sync",
			link: videoURL,
			filePath: filePath,
		},
			(response) => log(response.actionStatus)
		);

	} catch (error) {
		return error;
	}
};

const downloadSubs = async (subsURL, filePath) => {
	try {
		chrome.runtime.sendMessage({
			action: "download-sync",
			link: subsURL,
			filePath: filePath,
		},
			(response) => log(response.actionStatus)
		);
	} catch (error) {
		return error;
	}
};


const getStorageValue = () => {
	chrome.storage.sync.get('speedPercent', function (data) {
		DURATION_PERCENT = data.speedPercent;
	});
};



const downloadCourse = async (courseJSON, startWithVideoId) => {
	try {
		const {
			id: courseId,
			title: courseName,
			authors,
			modules: sections,
		} = courseJSON;

		const authorName = authors[0].displayName != undefined ? authors[0].displayName : authors[0].authorHandle;
		if (authorName == undefined)
			authorName = "noName";


		// download all videos when no startid was given
		let startToggle = startWithVideoId == null || startWithVideoId == '';

		log(`#################### "${courseName} By ${authorName}" ####################`, 'INFO')
		for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
			const {
				id: sectionId,
				title: sectionName,
				contentItems: sectionItems,
			} = sections[sectionIndex];

			log(`==================== "${sectionName}" ====================`, 'INFO')

			for (let videoIndex = 0; videoIndex < sectionItems.length; videoIndex++) {
				if (CONTINUE_DOWNLOAD) {
					const {
						id: videoId,
						title: videoName,
						version: versionId,
						duration,
					} = sectionItems[videoIndex];

					if (!startToggle) {
						if (videoId == startWithVideoId) {
							startToggle = true;
						}
					}

					if (!startToggle) {
						console.log(`Skipping [${videoId}] ${videoName}`);
						continue;
					}
					console.log(`Downloading [${videoId}] ${videoName}`);

					const filePath = await getFilePath(
						removeInvalidCharacters(courseName),
						removeInvalidCharacters(authorName),
						sectionIndex,
						removeInvalidCharacters(sectionName),
						videoIndex,
						removeInvalidCharacters(videoName),
						`${EXTENSION}`
					);

					const filePath_subs = await getFilePath(
						removeInvalidCharacters(courseName),
						removeInvalidCharacters(authorName),
						sectionIndex,
						removeInvalidCharacters(sectionName),
						videoIndex,
						removeInvalidCharacters(videoName),
						`${EXTENSION_SUBS}`
					);

					const videoURL = await getVideoURL(videoId);
					const subsURL = await getSubtitleURL(videoId, versionId);

					log(`Downloading... "${videoName}"`, 'DOWNLOAD')

					getStorageValue();


					chrome.storage.sync.set({ Status: "Downloading..." }, undefined);
					await downloadVideo(videoURL, filePath);

					// Progress Informaton Update on Storage
					chrome.storage.sync.set({ Completion_Module: `${sectionIndex + 1}/${sections.length}` }, undefined);
					chrome.storage.sync.set({ Completion_Video: `${videoIndex + 1}/${sectionItems.length}` }, undefined);
					await sleep(DOWNLOAD_TIMEOUT);
					await downloadSubs(subsURL, filePath_subs);

					chrome.storage.sync.set({ Status: "Waiting..." }, undefined);
					// Sleep for duration based on a constant updated by speedPercent from extesion browser
					await sleep(Math.max(duration * 10 * DURATION_PERCENT - DOWNLOAD_TIMEOUT, DOWNLOAD_TIMEOUT));

				} else {
					CONTINUE_DOWNLOAD = false
					DOWNLOADING = false
					log('Downloading stopped!!!')
					return
				}
			}
		}

		DOWNLOADING = false
		log('Downloading finished!!!')
		confirm("Downloading finished");

		if (CONTINUE_DOWNLOAD)
			chrome.storage.sync.set({ Status: "Finished" }, undefined);
		else
			chrome.storage.sync.set({ Status: "Cancelled" }, undefined);

	} catch (error) {
		log(error, 'ERROR')
		chrome.storage.sync.set({ Status: "Stopped" }, undefined);
		return error;
	}
};

const getCurrentVideoId = () => {
	const vIdMatch = location.search.match("clipId=?([0-9a-f-]*)");
	return vIdMatch ? vIdMatch[1] : null;
}


chrome.runtime.onMessage.addListener(
	function (request, sender, sendResponse) {
		console.log(request);
		if (request.target != "script") {
			return;
		}

		if (request.message === "enablechanged") {
			// console.log({ "received msg": "Enable changed", "datay": request.data });
		
			EXTENSION_ENABLED = request.data === true;

			chrome.storage.sync.set({ EXTENSION_ENABLED: EXTENSION_ENABLED }, undefined);
			// sendMessageToPopup("enablechanged", EXTENSION_ENABLED);
			debugger;
			sendResponse({ target: "popup", message: "enablechanged", data: EXTENSION_ENABLED });
		}
	}
);


const changeDownloadState = () => {

}



// main-function
$(() => {
	$(document).keypress(async (e) => {
		console.log(`Keypress: ${e.which}`);
		if ((e.which === 101 || e.which === 69)) {

			// KEYPRESS `CTRL-e`
			// Enable/Disabled extension bindings
			!EXTENSION_ENABLED ? log('Enabled the extension bindings.') : log('Disabled the extension bindings.')
			EXTENSION_ENABLED = !EXTENSION_ENABLED

			chrome.storage.sync.set({ EXTENSION_ENABLED: EXTENSION_ENABLED }, undefined);

			let vId = getCurrentVideoId();
			log(`vid: ${vId}`);
			return;
		}

		if (!EXTENSION_ENABLED) {
			return;
		}

		const cmdStopDownload = e.which === 115 || e.which === 83;
		const cmdDownloadAll = e.which === 99 || e.which === 67; // Download the entire course | key: c
		const cmdDownloadFromNowOn = e.which === 86 || e.which === 118; //key: v

		if (cmdStopDownload) {

			// KEYPRESS `s`
			// Stops the download the process, it won't stop the current download, it will abort the download of further videos
			log('Stopping the download process...')
			CONTINUE_DOWNLOAD = false

		}

		if (DOWNLOADING) {
			return;
		}

		if (cmdDownloadAll || cmdDownloadFromNowOn) {
			// KEYPRESS `CTRL-c`
			log('Downloading course...')
			log('Fetching course information...')

			DOWNLOADING = true;

			const courseJSON = JSON
				.parse($(window.__NEXT_DATA__).text())
				.props
				.pageProps
				.tableOfContents;

			let videoInfo = cmdDownloadFromNowOn ? getCurrentVideoId() : null;
			await downloadCourse(courseJSON, videoInfo);
		}
	});
});
