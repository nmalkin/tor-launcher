// Copyright (c) 2015, The Tor Project, Inc.
// See LICENSE for licensing information.
//
// vim: set sw=2 sts=2 ts=8 et syntax=javascript:

// TODO: if clean start and "Unable to read Tor settings" error is displayed, we should not bootstrap Tor or start the browser.

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "TorLauncherUtil",
                          "resource://torlauncher/modules/tl-util.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "TorLauncherLogger",
                          "resource://torlauncher/modules/tl-logger.jsm");

const kPrefPromptForLocale = "extensions.torlauncher.prompt_for_locale";
const kPrefLocale = "general.useragent.locale";
const kPrefMatchOSLocale = "intl.locale.matchOS";

const kPrefDefaultBridgeRecommendedType =
                   "extensions.torlauncher.default_bridge_recommended_type";
const kPrefDefaultBridgeType = "extensions.torlauncher.default_bridge_type";

const kSupportAddr = "help@rt.torproject.org";

const kTorProcessReadyTopic = "TorProcessIsReady";
const kTorProcessExitedTopic = "TorProcessExited";
const kTorProcessDidNotStartTopic = "TorProcessDidNotStart";
const kTorOpenProgressTopic = "TorOpenProgressDialog";
const kTorBootstrapErrorTopic = "TorBootstrapError";
const kTorLogHasWarnOrErrTopic = "TorLogHasWarnOrErr";

const kWizardProxyRadioGroup = "proxyRadioGroup";
const kWizardUseBridgesRadioGroup = "useBridgesRadioGroup";

const kWizardFirstPageID = "first";

const kLocaleList = "localeList";
const kUseProxyCheckbox = "useProxy";
const kProxyTypeMenulist = "proxyType";
const kProxyAddr = "proxyAddr";
const kProxyPort = "proxyPort";
const kProxyUsername = "proxyUsername";
const kProxyPassword = "proxyPassword";
const kUseFirewallPortsCheckbox = "useFirewallPorts";
const kFirewallAllowedPorts = "firewallAllowedPorts";
const kUseBridgesCheckbox = "useBridges";
const kDefaultBridgeTypeMenuList = "defaultBridgeType";
const kCustomBridgesRadio = "bridgeRadioCustom";
const kBridgeList = "bridgeList";

const kTorConfKeyDisableNetwork = "DisableNetwork";
const kTorConfKeySocks4Proxy = "Socks4Proxy";
const kTorConfKeySocks5Proxy = "Socks5Proxy";
const kTorConfKeySocks5ProxyUsername = "Socks5ProxyUsername";
const kTorConfKeySocks5ProxyPassword = "Socks5ProxyPassword";
const kTorConfKeyHTTPSProxy = "HTTPSProxy";
const kTorConfKeyHTTPSProxyAuthenticator = "HTTPSProxyAuthenticator";
const kTorConfKeyReachableAddresses = "ReachableAddresses";
const kTorConfKeyUseBridges = "UseBridges";
const kTorConfKeyBridgeList = "Bridge";

var gProtocolSvc = null;
var gTorProcessService = null;
var gObsService = null;
var gHasQuitButton = false;
var gIsInitialBootstrap = false;
var gIsBootstrapComplete = false;
var gRestoreAfterHelpPanelID = null;
var gActiveTopics = [];  // Topics for which an observer is currently installed.

function generateSummary(){
  if (TorLauncherUtil.getCharPref(kPrefDefaultBridgeType, null)){
    document.getElementById("summaryBridge").textContent = "Bridge: " + TorLauncherUtil.getCharPref(kPrefDefaultBridgeType, null);
  } 
  else {
    document.getElementById("summaryBridge").textContent = "Bridge: None selected."
  }
  if (isProxyConfigured()){
    document.getElementById("summaryProxy").textContent = "Proxy Type: " + getElemValue(kProxyTypeMenulist, null)
    document.getElementById("summaryAddress").textContent ="Address: " + getElemValue(kProxyAddr, null);
    document.getElementById("summaryPort").textContent = "Port: " + getElemValue(kProxyPort, null);
    document.getElementById("summaryUsername").textContent = "Username: " + getElemValue(kProxyUsername);
    document.getElementById("summaryPassword").textContent = "Password: " + getElemValue(kProxyPassword);
  }
  else{
    document.getElementById("summaryProxy").textContent = "Proxy Type: " + "None selected."
  }
}

function generateProgress(){
  if (TorLauncherUtil.getCharPref(kPrefDefaultBridgeType, null)){
    document.getElementById("progressBridge").textContent = "Bridge: " + TorLauncherUtil.getCharPref(kPrefDefaultBridgeType, null);
  } 
  else {
    document.getElementById("progressBridge").textContent = "Bridge: None selected."
  }
  if (isProxyConfigured()){
    document.getElementById("progressProxy").textContent = "Proxy Type: " + getElemValue(kProxyTypeMenulist, null)
    document.getElementById("progressAddress").textContent ="Address: " + getElemValue(kProxyAddr, null);
    document.getElementById("progressPort").textContent = "Port: " + getElemValue(kProxyPort, null);
    document.getElementById("progressUsername").textContent = "Username: " + getElemValue(kProxyUsername);
    document.getElementById("progressPassword").textContent = "Password: " + getElemValue(kProxyPassword);
  }
  else{
    document.getElementById("progressProxy").textContent = "Proxy Type: " + "None selected."
  }
}

function initDialogCommon(aHasQuitButton)
{
  gHasQuitButton = aHasQuitButton;

  gObsService = Cc["@mozilla.org/observer-service;1"]
                  .getService(Ci.nsIObserverService);

  let isWindows = TorLauncherUtil.isWindows;
  if (isWindows)
    document.documentElement.setAttribute("class", "os-windows");
  else if (TorLauncherUtil.isMac)
    document.documentElement.setAttribute("class", "os-mac");

  let forAssistance = document.getElementById("forAssistance");
  if (forAssistance)
  {
    forAssistance.textContent = TorLauncherUtil.getFormattedLocalizedString(
                                        "forAssistance", [kSupportAddr], 1);
  }

  if (aHasQuitButton)
  {
    let cancelBtn = document.documentElement.getButton("cancel");
    if (cancelBtn)
    {
      let quitKey = isWindows ? "quit_win" : "quit";
      cancelBtn.label = TorLauncherUtil.getLocalizedString(quitKey);
    }
  }

  let wizardElem = getWizard();
  let haveWizard = (wizardElem != null);
  if (haveWizard)
  {
    // Hide the Tor Browser logo and associated separator element if the
    // TOR_HIDE_BROWSER_LOGO environment variable is set.
    let env = Cc["@mozilla.org/process/environment;1"]
                .getService(Ci.nsIEnvironment);
    if (env.exists("TOR_HIDE_BROWSER_LOGO"))
      wizardElem.setAttribute("tor_hide_browser_logo", true);
  }
}


function resizeDialogToFitContent()
{
  // Resize this window to fit content.  sizeToContent() alone will not do
  // the job (it has many limitations and it is buggy).
  sizeToContent();
  let w = maxWidthOfContent();
  if (w)
  {
    let windowFrameWidth = window.outerWidth - window.innerWidth;
    w += windowFrameWidth;

    if (w > window.outerWidth)
      window.resizeTo(w, window.outerHeight);
  }
}


function initDialog()
{
  gIsInitialBootstrap = window.arguments[0];
  initDialogCommon(gIsInitialBootstrap);

  var startAtPanel;
  if (window.arguments.length > 1)
    startAtPanel = window.arguments[1];

  if (gIsInitialBootstrap)
  {
    var okBtn = document.documentElement.getButton("accept");
    if (okBtn)
      okBtn.label = TorLauncherUtil.getLocalizedString("connect");
  }

  try
  {
    var svc = Cc["@torproject.org/torlauncher-protocol-service;1"]
                .getService(Ci.nsISupports);
    gProtocolSvc = svc.wrappedJSObject;
  }
  catch (e) { dump(e + "\n"); }

  try
  {
    var svc = Cc["@torproject.org/torlauncher-process-service;1"]
                .getService(Ci.nsISupports);
    gTorProcessService = svc.wrappedJSObject;
  }
  catch (e) { dump(e + "\n"); }

  var wizardElem = getWizard();
  var haveWizard = (wizardElem != null);
  if (haveWizard)
  {
    // Set "Copy Tor Log" label and move it after the Quit (cancel) button.
    var copyLogBtn = document.documentElement.getButton("extra2");
    if (copyLogBtn)
    {
      copyLogBtn.label = wizardElem.getAttribute("buttonlabelextra2");
      var cancelBtn = document.documentElement.getButton("cancel");
      if (cancelBtn && TorLauncherUtil.isMac)
        cancelBtn.parentNode.insertBefore(copyLogBtn, cancelBtn.nextSibling);
    }

    if (gTorProcessService.TorBootstrapErrorOccurred ||
        gProtocolSvc.TorLogHasWarnOrErr)
    {
      showCopyLogButton(true);
    }

    // Use "Connect" as the finish button label (on the last wizard page)..
    var finishBtn = document.documentElement.getButton("finish");
    finishBtn.className="green_button";
    if (finishBtn)
      finishBtn.label = TorLauncherUtil.getLocalizedString("connect");

    // Add label and access key to Help button.
    var helpBtn = document.documentElement.getButton("help");
    if (helpBtn)
    {
      var strBundle = Cc["@mozilla.org/intl/stringbundle;1"]
                    .getService(Ci.nsIStringBundleService)
                    .createBundle("chrome://global/locale/dialog.properties");
      helpBtn.setAttribute("label", strBundle.GetStringFromName("button-help"));
      var accessKey = strBundle.GetStringFromName("accesskey-help");
      if (accessKey)
        helpBtn.setAttribute("accesskey", accessKey);
    }

    // Set Discard Settings back button label to match the wizard Back button.
    let wizardBackBtn = document.documentElement.getButton("back");
    let backBtn = document.getElementById("discardSettingsGoBack");
    if (wizardBackBtn && backBtn)
      backBtn.label = wizardBackBtn.label;
  }

  initDefaultBridgeTypeMenu();

  addObserver(kTorBootstrapErrorTopic);
  addObserver(kTorLogHasWarnOrErrTopic);
  addObserver(kTorProcessExitedTopic);
  addObserver(kTorOpenProgressTopic);

  var status = gTorProcessService.TorProcessStatus;
  if (TorLauncherUtil.shouldStartAndOwnTor &&
     (status != gTorProcessService.kStatusRunning))
  {
    if (status == gTorProcessService.kStatusExited)
      showErrorMessage(true, null, false);
    else
      showStartingTorPanel();
    addObserver(kTorProcessReadyTopic);
    addObserver(kTorProcessDidNotStartTopic);
  }
  else
  {
    readTorSettings();

    if (startAtPanel)
      advanceToWizardPanel(startAtPanel);
    else
      showPanel();
  }

  resizeDialogToFitContent();

  TorLauncherLogger.log(2, "initDialog done");
}


function initLocaleDialog()
{
  initDialogCommon(true);

  // Replace the finish button's label ("Done") with the next button's
  // label ("Next" or "Continue").
  let nextBtn = document.documentElement.getButton("next");
  let doneBtn = document.documentElement.getButton("finish");
  if (nextBtn && doneBtn)
    doneBtn.label = nextBtn.label;

  let { AddonManager } = Cu.import("resource://gre/modules/AddonManager.jsm");
  AddonManager.getAddonsByTypes(["locale"], function(aLangPackAddons)
      {
        populateLocaleList(aLangPackAddons);
        resizeDialogToFitContent();
        TorLauncherLogger.log(2, "initLocaleDialog done");
      });
}


function populateLocaleList(aLangPackAddons)
{
  let knownLanguages = {
    "en-US" : "English",
    "ar"    : "\u0627\u0644\u0639\u0631\u0628\u064a\u0629",
    "de"    : "Deutsch",
    "es-ES" : "Espa\u00f1ol",
    "fa"    : "\u0641\u0627\u0631\u0633\u06cc",
    "fr"    : "Fran\u00e7ais",
    "it"    : "Italiano",
    "ja"    : "\u65e5\u672c\u8a9e",
    "ko"    : "\ud55c\uad6d\uc5b4",
    "nl"    : "Nederlands",
    "pl"    : "Polski",
    "pt-PT" : "Portugu\u00eas (Europeu)",
    "ru"    : "\u0420\u0443\u0441\u0441\u043a\u0438\u0439",
    "tr"    : "T\u00fcrk\u00e7e",
    "vi"    : "Ti\u1ebfng Vi\u1ec7t",
    "zh-CN" : "\u7b80\u4f53\u5b57"
  };

  // Retrieve the current locale so we can select it within the list by default.
  let curLocale;
  try
  {
    let chromeRegSvc = Cc["@mozilla.org/chrome/chrome-registry;1"]
                         .getService(Ci.nsIXULChromeRegistry);
    curLocale = chromeRegSvc.getSelectedLocale("global").toLowerCase();
  } catch (e) {}

  // Build a list of language info objects (language code plus friendly name).
  let foundCurLocale = false;
  let langInfo = [];
  for (let addon of aLangPackAddons)
  {
    let uri = addon.getResourceURI("");
    // The add-on IDs look like langpack-LANGCODE@firefox.mozilla.org
    let matchResult = addon.id.match(/^langpack-(.*)@.*\.mozilla\.org/);
    let code = (matchResult) ? matchResult[1] : addon.id;
    if (code == "ja-JP-mac")
      code = "ja";
    let name = knownLanguages[code];
    if (!name)
    {
      // We do not have a name for this language pack. Use some heuristics.
      name = addon.name;
      let idx = name.lastIndexOf(" Language Pack");
      if (idx > 0)
        name = name.substring(0, idx);
    }
    let isSelected = (curLocale && (code.toLowerCase() == curLocale));
    langInfo.push({ langCode: code, langName: name, isSelected: isSelected } );
    if (isSelected && !foundCurLocale)
      foundCurLocale = true;
  }

  // Sort by language code.
  langInfo.sort(function(aObj1, aObj2) {
      if (aObj1.langCode == aObj2.langCode)
        return 0;

      return (aObj1.langCode < aObj2.langCode) ? -1 : 1;
    });

  // Add en-US to the beginning of the list.
  let code = "en-US";
  let name = knownLanguages[code];
  let isSelected = !foundCurLocale;  // select English if nothing else matched
  langInfo.splice(0, 0,
                  { langCode: code, langName: name, isSelected: isSelected });

  // Populate the XUL listbox.
  let localeList = document.getElementById(kLocaleList);
  for (let infoObj of langInfo)
  {
    let listItem = document.createElement("listitem");
    listItem.setAttribute("value", infoObj.langCode);
    listItem.setAttribute("label", infoObj.langName);
    localeList.appendChild(listItem);
    if (infoObj.isSelected)
      localeList.selectedItem = listItem;
  }
}


function deinitDialog()
{
  removeAllObservers();
}


// For now, we assume that the wizard buttons are the widest portion.
// TODO: return a value for the settings dialog (non-wizard case).
function maxWidthOfContent()
{
  let haveWizard = (getWizard() != null);
  if (!haveWizard)
    return undefined;

  // Show all buttons so we can get an accurate width measurement.
  // They will be hidden, as necessary, by the wizard.
  let buttons = "back,next,cancel,extra2,help".split(',');
  for (let i = 0; i < buttons.length; ++i)
    showOrHideButton(buttons[i], true, false);

  let btn = document.documentElement.getButton("cancel");
  let btnContainer = btn.parentElement;

  const kWarningIconWidth = 20; // skin/warning.png is 16 plus some margin
  let r = btnContainer.getBoundingClientRect();

  // Hide copy log button if appropriate.
  restoreCopyLogVisibility();

  return Math.ceil((2 * r.left) + r.width + kWarningIconWidth);
}


function getWizard()
{
  let elem = document.getElementById("TorNetworkSettings");
  if (!elem)
    elem = document.getElementById("TorLauncherLocalePicker");
  return (elem && (elem.tagName == "wizard")) ? elem : null;
}


function onWizardFirstPanelConnect()
{
  // If the user configured bridge or proxy settings, prompt before
  // discarding their data.
  if (isBridgeConfigured() || isProxyConfigured())
    showPanel("discardSettings");
  else
    removeSettingsAndConnect()
}


function removeSettingsAndConnect()
{
  applySettings(true);  // Use default settings.
  if (!gIsBootstrapComplete)
    readTorSettings();  // Ensure UI matches the settings that were used.
}


function onWizardConfigure()
{
  getWizard().advance("bridges");
}


function onWizardProxyNext(aWizPage)
{
  if (aWizPage)
  {
    var hasProxy = getElemValue("proxyRadioYes", false);
    aWizPage.next = (hasProxy) ? "proxyYES" : "";
  }

  return true;
}


function onWizardUseProxyRadioChange()
{
  var wizard = getWizard();
  if (wizard && wizard.currentPage)
  {
    var hasProxy = getElemValue("proxyRadioYes", false);
    wizard.setAttribute("lastpage", !hasProxy);
    wizard._wizardButtons.onPageChange();
  }
}


function onWizardProxySettingsShow()
{
  var wizard = getWizard();
  if (wizard)
  {
    wizard.setAttribute("lastpage", true);
    wizard._wizardButtons.onPageChange();
  }
}


function onWizardUseBridgesNext(aWizPage)
{
  if (aWizPage)
  {
    var useBridges = getElemValue("bridgesRadioYes", false);
    aWizPage.next = (useBridges) ? "bridgeSettings" : "proxy";
  }

  return true;
}


function onWizardBridgeSettingsShow()
{
  var btn = document.documentElement.getButton("next");
  btn.className="green_button";
  if (btn)
    btn.focus();
}


function onCustomBridgesTextInput()
{
  var customBridges = document.getElementById(kCustomBridgesRadio);
  if (customBridges)
    customBridges.control.selectedItem = customBridges;
  onBridgeTypeRadioChange();
}


function onBridgeTypeRadioChange()
{
  var useCustom = getElemValue(kCustomBridgesRadio, false);
  enableElemWithLabel(kDefaultBridgeTypeMenuList, !useCustom);
  enableElemWithLabel(kBridgeList + "Label", useCustom);
  var focusElemID = (useCustom) ? kBridgeList : kDefaultBridgeTypeMenuList;
  var elem = document.getElementById(focusElemID);
  if (elem)
    elem.focus();
}


function showWizardNavButtons(aShowBtns)
{
  showOrHideButton("back", aShowBtns, false);
  showOrHideButton("next", aShowBtns, false);
}


var gObserver = {
  observe: function(aSubject, aTopic, aData)
  {
    if ((kTorBootstrapErrorTopic == aTopic) ||
         (kTorLogHasWarnOrErrTopic == aTopic))
    {
      showCopyLogButton(true);
      return;
    }

    if (kTorProcessReadyTopic == aTopic)
    {
      removeObserver(kTorProcessReadyTopic);
      removeObserver(kTorProcessDidNotStartTopic);
      var haveWizard = (getWizard() != null);
      showPanel();
      if (haveWizard)
        showWizardNavButtons(true);
      readTorSettings();
    }
    else if (kTorProcessDidNotStartTopic == aTopic)
    {
      removeObserver(kTorProcessReadyTopic);
      removeObserver(kTorProcessDidNotStartTopic);
      showErrorMessage(false, aData, false);
    }
    else if (kTorProcessExitedTopic == aTopic)
    {
      removeObserver(kTorProcessExitedTopic);
      showErrorMessage(true, null, false);
    }
    else if (kTorOpenProgressTopic == aTopic)
    {
      openProgressDialog();
    }
  }
};


// addObserver() will not add two observers for the same topic.
function addObserver(aTopic)
{
  if (gActiveTopics.indexOf(aTopic) < 0)
  {
    gObsService.addObserver(gObserver, aTopic, false);
    gActiveTopics.push(aTopic);
  }
}


function removeObserver(aTopic)
{
  let idx = gActiveTopics.indexOf(aTopic);
  if (idx >= 0)
  {
    gObsService.removeObserver(gObserver, aTopic);
    gActiveTopics.splice(idx, 1);
  }
}


function removeAllObservers()
{
  for (let i = gActiveTopics.length - 1; i >= 0; --i)
    gObsService.removeObserver(gObserver, gActiveTopics[i]);

  gActiveTopics = [];
}


function readTorSettings()
{
  TorLauncherLogger.log(2, "readTorSettings " +
                            "----------------------------------------------");

  var didSucceed = false;
  try
  {
    // TODO: retrieve > 1 key at one time inside initProxySettings() et al.
    didSucceed = initBridgeSettings() &&
                 initProxySettings() && initFirewallSettings();
  }
  catch (e) { TorLauncherLogger.safelog(4, "Error in readTorSettings: ", e); }

  if (!didSucceed)
  {
    // Unable to communicate with tor.  Hide settings and display an error.
    showErrorMessage(false, null, false);

    setTimeout(function()
        {
          var details = TorLauncherUtil.getLocalizedString(
                                          "ensure_tor_is_running");
          var s = TorLauncherUtil.getFormattedLocalizedString(
                                      "failed_to_get_settings", [details], 1);
          TorLauncherUtil.showAlert(window, s);
          close();
        }, 0);
  }
  TorLauncherLogger.log(2, "readTorSettings done");
}


// If aPanelID is undefined, the first panel is displayed.
function showPanel(aPanelID)
{
  var wizard = getWizard();
  if (!aPanelID)
    aPanelID = (wizard) ? kWizardFirstPageID : "settings";

  var deckElem = document.getElementById("deck");
  if (deckElem)
    deckElem.selectedPanel = document.getElementById(aPanelID);
  else if (wizard.currentPage.pageid != aPanelID)
    wizard.goTo(aPanelID);

  if (wizard && (aPanelID == kWizardFirstPageID))
    setTimeout( function() { showWizardNavButtons(false); }, 0);

  showOrHideButton("accept", (aPanelID == "settings"), true);
}


// This function assumes that you are starting on the first page.
function advanceToWizardPanel(aPanelID)
{
  var wizard = getWizard();
  if (!wizard)
    return;

  onWizardConfigure(); // Equivalent to pressing "Configure"

  const kMaxTries = 10;
  for (var count = 0;
       ((count < kMaxTries) &&
        (wizard.currentPage.pageid != aPanelID) &&
        wizard.canAdvance);
       ++count)
  {
    wizard.advance();
  }
}


function showStartingTorPanel()
{
  var haveWizard = (getWizard() != null);
  if (haveWizard)
    showWizardNavButtons(false);

  showPanel("startingTor");
}


function showErrorMessage(aTorExited, aErrorMsg, aShowReconfigButton)
{
  var elem = document.getElementById("errorPanelMessage");
  var btn = document.getElementById("restartTorButton");
  if (aTorExited)
  {
    // Show "Tor exited" message and "Restart Tor" button.
    aErrorMsg = TorLauncherUtil.getLocalizedString("tor_exited")
                + "\n\n" + TorLauncherUtil.getLocalizedString("tor_exited2");

    if (btn)
      btn.removeAttribute("hidden");
    if (elem)
      elem.style.textAlign = "start";
  }
  else
  {
    if (btn)
      btn.setAttribute("hidden", true);
    if (elem)
      elem.style.textAlign = "center";
  }

  if (elem)
    elem.textContent = (aErrorMsg) ? aErrorMsg : "";

  let reconfigBtn = document.getElementById("reconfigTorButton");
  if (reconfigBtn)
  {
    if (aShowReconfigButton)
      reconfigBtn.removeAttribute("hidden");
    else
      reconfigBtn.setAttribute("hidden", true);
  }

  showPanel("errorPanel");

  var haveWizard = (getWizard() != null);
  if (haveWizard)
    showWizardNavButtons(false);

  var haveErrorOrWarning = (gTorProcessService.TorBootstrapErrorOccurred ||
                            gProtocolSvc.TorLogHasWarnOrErr)
  showCopyLogButton(haveErrorOrWarning);
}


function showCopyLogButton(aHaveErrorOrWarning)
{
  let copyLogBtn = document.documentElement.getButton("extra2");
  if (copyLogBtn)
  {
    let haveWizard = (getWizard() != null);
    if (haveWizard)
      copyLogBtn.setAttribute("wizardCanCopyLog", true);

    if (!gRestoreAfterHelpPanelID)
      copyLogBtn.removeAttribute("hidden"); // Show button if help is not open.

    if (aHaveErrorOrWarning)
    {
      let clz = copyLogBtn.getAttribute("class");
      if (!clz)
        copyLogBtn.setAttribute("class", "torWarning");
      else if (clz.indexOf("torWarning") < 0)
        copyLogBtn.setAttribute("class", clz + " torWarning");
    }
  }
}


function restoreCopyLogVisibility()
{
  let copyLogBtn = document.documentElement.getButton("extra2");
  if (!copyLogBtn)
    return;

  // Always show button in non-wizard case; conditionally in wizard.
  if (!getWizard() || copyLogBtn.hasAttribute("wizardCanCopyLog"))
    copyLogBtn.removeAttribute("hidden");
  else
    copyLogBtn.setAttribute("hidden", true);
}


function showOrHideButton(aID, aShow, aFocus)
{
  var btn = setButtonAttr(aID, "hidden", !aShow);
  if (btn && aFocus)
    btn.focus()
}


// Returns the button element (if found).
function enableButton(aID, aEnable)
{
  return setButtonAttr(aID, "disabled", !aEnable);
}


// Returns the button element (if found).
function setButtonAttr(aID, aAttr, aValue)
{
  if (!aID || !aAttr)
    return null;

  var btn = document.documentElement.getButton(aID);
  if (btn)
  {
    if (aValue)
      btn.setAttribute(aAttr, aValue);
    else
      btn.removeAttribute(aAttr);
  }

  return btn;
}


// Enables / disables aID as well as optional aID+"Label" element.
function enableElemWithLabel(aID, aEnable)
{
  if (!aID)
    return;

  var elem = document.getElementById(aID);
  if (elem)
  {
    var label = document.getElementById(aID + "Label");
    if (aEnable)
    {
      if (label)
        label.removeAttribute("disabled");

      elem.removeAttribute("disabled");
    }
    else
    {
      if (label)
        label.setAttribute("disabled", true);

      elem.setAttribute("disabled", true);
    }
  }
}


// Removes placeholder text when disabled.
function enableTextBox(aID, aEnable)
{
  enableElemWithLabel(aID, aEnable);
  var textbox = document.getElementById(aID);
  if (textbox)
  {
    if (aEnable)
    {
      var s = textbox.getAttribute("origPlaceholder");
      if (s)
        textbox.setAttribute("placeholder", s);
    }
    else
    {
      textbox.setAttribute("origPlaceholder", textbox.placeholder);
      textbox.removeAttribute("placeholder");
    }
  }
}


function overrideButtonLabel(aID, aLabelKey)
{
  var btn = document.documentElement.getButton(aID);
  if (btn)
  {
    btn.setAttribute("origLabel", btn.label);
    btn.label = TorLauncherUtil.getLocalizedString(aLabelKey);
  }
}


function restoreButtonLabel(aID)
{
  var btn = document.documentElement.getButton(aID);
  if (btn)
  {
    var oldLabel = btn.getAttribute("origLabel");
    if (oldLabel)
    {
      btn.label = oldLabel;
      btn.removeAttribute("origLabel");
    }
  }
}


function onLocaleListDoubleClick()
{
  getWizard().advance();
}


function setLocale()
{
  let locale = getElemValue(kLocaleList, "en-US");
  if (TorLauncherUtil.isMac && ("ja" == locale))
    locale = "ja-JP-mac";
  TorLauncherUtil.setCharPref(kPrefLocale, locale);
  TorLauncherUtil.setBoolPref(kPrefPromptForLocale, false);
  TorLauncherUtil.setBoolPref(kPrefMatchOSLocale, false);

  // Clear cached strings so the new locale takes effect.
  TorLauncherUtil.flushLocalizedStringCache();
  gObsService.notifyObservers(null, "chrome-flush-caches", null);
}


function onProxyTypeChange()
{
  var proxyType = getElemValue(kProxyTypeMenulist, null);
  var mayHaveCredentials = (proxyType != "SOCKS4");
  enableTextBox(kProxyUsername, mayHaveCredentials);
  enableTextBox(kProxyPassword, mayHaveCredentials);
}


// Called when user clicks "Restart Tor" button after tor unexpectedly quits.
function onRestartTor()
{
  // Re-add these observers in case they have been removed.
  addObserver(kTorProcessReadyTopic);
  addObserver(kTorProcessDidNotStartTopic);
  addObserver(kTorProcessExitedTopic);

  gTorProcessService._startTor();
  gTorProcessService._controlTor();
}


function onWizardReconfig()
{
  showPanel(kWizardFirstPageID);
  onWizardConfigure();
  // Because a similar delayed call is used to hide the buttons when the
  // first wizard page is displayed, we use setTimeout() here to ensure
  // that the navigation buttons are visible.
  window.setTimeout(function() { showWizardNavButtons(true); }, 0);
}


function onCancel()
{
  if (gRestoreAfterHelpPanelID) // Is help open?
  {
    closeHelp();
    return false;
  }

  if (gHasQuitButton) try
  {
    gObsService.notifyObservers(null, "TorUserRequestedQuit", null);
  } catch (e) {}

  return true;
}


function onCopyLog()
{
  // Copy tor log messages to the system clipboard.
  var chSvc = Cc["@mozilla.org/widget/clipboardhelper;1"]
                             .getService(Ci.nsIClipboardHelper);
  let countObj = { value: 0 };
  chSvc.copyString(gProtocolSvc.TorGetLog(countObj));

  // Display a feedback popup that fades away after a few seconds.
  let forAssistance = document.getElementById("forAssistance");
  let panel = document.getElementById("copyLogFeedbackPanel");
  if (forAssistance && panel)
  {
    panel.firstChild.textContent = TorLauncherUtil.getFormattedLocalizedString(
                                     "copiedNLogMessages", [countObj.value], 1);
    let rectObj = forAssistance.getBoundingClientRect();
    panel.openPopup(null, null, rectObj.left, rectObj.top, false, false);
  }
}


function closeCopyLogFeedbackPanel()
{
  let panel = document.getElementById("copyLogFeedbackPanel");
  if (panel && (panel.state =="open"))
    panel.hidePopup();
}


function onOpenHelp()
{
  if (gRestoreAfterHelpPanelID) // Already open?
    return;

  var deckElem = document.getElementById("deck");
  if (deckElem)
    gRestoreAfterHelpPanelID = deckElem.selectedPanel.id;
  else
    gRestoreAfterHelpPanelID = getWizard().currentPage.pageid;

  showPanel("bridgeHelp");

  showOrHideButton("extra2", false, false); // Hide "Copy Tor Log To Clipboard"

  if (getWizard())
  {
    showOrHideButton("cancel", false, false);
    showOrHideButton("back", false, false);
    overrideButtonLabel("next", "done");
    var forAssistance = document.getElementById("forAssistance");
    if (forAssistance)
      forAssistance.setAttribute("hidden", true);
  }
  else
  {
    overrideButtonLabel("cancel", "done");
  }
}


function closeHelp()
{
  if (!gRestoreAfterHelpPanelID)  // Already closed?
    return;

  restoreCopyLogVisibility();

  if (getWizard())
  {
    showOrHideButton("cancel", true, false);
    showOrHideButton("back", true, false);
    restoreButtonLabel("next");
    var forAssistance = document.getElementById("forAssistance");
    if (forAssistance)
      forAssistance.removeAttribute("hidden");
  }
  else
  {
    restoreButtonLabel("cancel");
  }

  showPanel(gRestoreAfterHelpPanelID);
  gRestoreAfterHelpPanelID = null;
}


// Returns true if successful.
function initProxySettings()
{
  var proxyType, proxyAddrPort, proxyUsername, proxyPassword;
  var reply = gProtocolSvc.TorGetConfStr(kTorConfKeySocks4Proxy, null);
  if (!gProtocolSvc.TorCommandSucceeded(reply))
    return false;

  if (reply.retVal)
  {
    proxyType = "SOCKS4";
    proxyAddrPort = reply.retVal;
  }
  else
  {
    var reply = gProtocolSvc.TorGetConfStr(kTorConfKeySocks5Proxy, null);
    if (!gProtocolSvc.TorCommandSucceeded(reply))
      return false;

    if (reply.retVal)
    {
      proxyType = "SOCKS5";
      proxyAddrPort = reply.retVal;
      var reply = gProtocolSvc.TorGetConfStr(kTorConfKeySocks5ProxyUsername,
                                             null);
      if (!gProtocolSvc.TorCommandSucceeded(reply))
        return false;

      proxyUsername = reply.retVal;
      var reply = gProtocolSvc.TorGetConfStr(kTorConfKeySocks5ProxyPassword,
                                             null);
      if (!gProtocolSvc.TorCommandSucceeded(reply))
        return false;

      proxyPassword = reply.retVal;
    }
    else
    {
      var reply = gProtocolSvc.TorGetConfStr(kTorConfKeyHTTPSProxy, null);
      if (!gProtocolSvc.TorCommandSucceeded(reply))
        return false;

      if (reply.retVal)
      {
        proxyType = "HTTP";
        proxyAddrPort = reply.retVal;
        var reply = gProtocolSvc.TorGetConfStr(
                                   kTorConfKeyHTTPSProxyAuthenticator, null);
        if (!gProtocolSvc.TorCommandSucceeded(reply))
          return false;

        var values = parseColonStr(reply.retVal);
        proxyUsername = values[0];
        proxyPassword = values[1];
      }
    }
  }

  var haveProxy = (proxyType != undefined);
  setYesNoRadioValue(kWizardProxyRadioGroup, haveProxy);
  setElemValue(kUseProxyCheckbox, haveProxy);
  setElemValue(kProxyTypeMenulist, proxyType);
  onProxyTypeChange();

  var proxyAddr, proxyPort;
  if (proxyAddrPort)
  {
    var values = parseColonStr(proxyAddrPort);
    proxyAddr = values[0];
    proxyPort = values[1];
  }

  setElemValue(kProxyAddr, proxyAddr);
  setElemValue(kProxyPort, proxyPort);
  setElemValue(kProxyUsername, proxyUsername);
  setElemValue(kProxyPassword, proxyPassword);

  return true;
} // initProxySettings


// Returns true if successful.
function initFirewallSettings()
{
  if (getWizard())
    return true;  // The wizard does not directly expose firewall settings.

  var allowedPorts;
  var reply = gProtocolSvc.TorGetConfStr(kTorConfKeyReachableAddresses, null);
  if (!gProtocolSvc.TorCommandSucceeded(reply))
    return false;

  if (reply.retVal)
  {
    var portStrArray = reply.retVal.split(',');
    for (var i = 0; i < portStrArray.length; i++)
    {
      var values = parseColonStr(portStrArray[i]);
      if (values[1])
      {
        if (allowedPorts)
          allowedPorts += ',' + values[1];
        else
          allowedPorts = values[1];
      }
    }
  }

  var haveFirewall = (allowedPorts != undefined);
  setElemValue(kUseFirewallPortsCheckbox, haveFirewall);
  if (allowedPorts)
    setElemValue(kFirewallAllowedPorts, allowedPorts);

  return true;
}


// Returns true if successful.
function initBridgeSettings()
{
  var typeList = TorLauncherUtil.defaultBridgeTypes;
  var canUseDefaultBridges = (typeList && (typeList.length > 0));
  var defaultType = TorLauncherUtil.getCharPref(kPrefDefaultBridgeType);
  var useDefault = canUseDefaultBridges && !!defaultType;

  // If not configured to use a default set of bridges, get UseBridges setting
  // from tor.
  var useBridges = useDefault;
  if (!useDefault)
  {
    var reply = gProtocolSvc.TorGetConfBool(kTorConfKeyUseBridges, false);
    if (!gProtocolSvc.TorCommandSucceeded(reply))
      return false;

    useBridges = reply.retVal;

    // Get bridge list from tor.
    var bridgeReply = gProtocolSvc.TorGetConf(kTorConfKeyBridgeList);
    if (!gProtocolSvc.TorCommandSucceeded(bridgeReply))
      return false;

    if (!setBridgeListElemValue(bridgeReply.lineArray))
    {
      if (canUseDefaultBridges)
        useDefault = true;  // We have no custom values... back to default.
      else
        useBridges = false; // No custom or default bridges are available.
    }
  }

  setElemValue(kUseBridgesCheckbox, useBridges);
  setYesNoRadioValue(kWizardUseBridgesRadioGroup, useBridges);

  if (!canUseDefaultBridges)
  {
    var label = document.getElementById("bridgeSettingsPrompt");
    if (label)
      label.setAttribute("hidden", true);

    var radioGroup = document.getElementById("bridgeTypeRadioGroup");
    if (radioGroup)
      radioGroup.setAttribute("hidden", true);
  }

  var radioID = (useDefault) ? "bridgeRadioDefault" : "bridgeRadioCustom";
  var radio = document.getElementById(radioID);
  if (radio)
    radio.control.selectedItem = radio;
  onBridgeTypeRadioChange();

  return true;
}


// Returns true if settings were successfully applied.
function applySettings(aUseDefaults)
{
  TorLauncherLogger.log(2, "applySettings ---------------------" +
                             "----------------------------------------------");
  var didSucceed = false;
  try
  {
    didSucceed = applyBridgeSettings(aUseDefaults) &&
                 applyProxySettings(aUseDefaults) &&
                 applyFirewallSettings(aUseDefaults);
  }
  catch (e) { TorLauncherLogger.safelog(4, "Error in applySettings: ", e); }

  if (didSucceed)
    useSettings();

  TorLauncherLogger.log(2, "applySettings done");

  return false;
}


function useSettings()
{
  var settings = {};
  settings[kTorConfKeyDisableNetwork] = false;
  setConfAndReportErrors(settings, null);

  gProtocolSvc.TorSendCommand("SAVECONF");
  gTorProcessService.TorClearBootstrapError();

  gIsBootstrapComplete = gTorProcessService.TorIsBootstrapDone;
  if (!gIsBootstrapComplete)
    openProgressDialog();

  let wizardElem = getWizard();
  if (gIsBootstrapComplete)
  {
    close();
  }
  else if (wizardElem)
  {
    // If the user went down the "Configure" path and another error (e.g.,
    // Tor Exited) has not already been shown, display a generic message
    // with a "Reconfigure" button.
    let pageid = wizardElem.currentPage.pageid;
    if ((pageid != kWizardFirstPageID) && (pageid != "errorPanel"))
    {
      let msg = TorLauncherUtil.getLocalizedString("tor_bootstrap_failed");
      showErrorMessage(false, msg, true);
    }
  }
}


function openProgressDialog()
{
  var chromeURL = "chrome://torlauncher/content/progress.xul";
  var features = "chrome,dialog=yes,modal=yes,dependent=yes";
  window.openDialog(chromeURL, "_blank", features,
                    gIsInitialBootstrap, onProgressDialogClose);
}


function onProgressDialogClose(aBootstrapCompleted)
{
  gIsBootstrapComplete = aBootstrapCompleted;
}


// Returns true if settings were successfully applied.
function applyProxySettings(aUseDefaults)
{
  let settings = aUseDefaults ? getDefaultProxySettings()
                              : getAndValidateProxySettings();
  if (!settings)
    return false;

  return setConfAndReportErrors(settings, "proxyYES");
}


function getDefaultProxySettings()
{
  let settings = {};
  settings[kTorConfKeySocks4Proxy] = null;
  settings[kTorConfKeySocks5Proxy] = null;
  settings[kTorConfKeySocks5ProxyUsername] = null;
  settings[kTorConfKeySocks5ProxyPassword] = null;
  settings[kTorConfKeyHTTPSProxy] = null;
  settings[kTorConfKeyHTTPSProxyAuthenticator] = null;
  return settings;
}


// Return a settings object if successful and null if not.
function getAndValidateProxySettings()
{
  var settings = getDefaultProxySettings();

  // TODO: validate user-entered data.  See Vidalia's NetworkPage::save()
  var proxyType, proxyAddrPort, proxyUsername, proxyPassword;
  if (isProxyConfigured())
  {
    proxyType = getElemValue(kProxyTypeMenulist, null);
    if (!proxyType)
    {
      reportValidationError("error_proxy_type_missing");
      return null;
    }

    proxyAddrPort = createColonStr(getElemValue(kProxyAddr, null),
                                   getElemValue(kProxyPort, null));
    if (!proxyAddrPort)
    {
      reportValidationError("error_proxy_addr_missing");
      return null;
    }

    if ("SOCKS4" != proxyType)
    {
      proxyUsername = getElemValue(kProxyUsername);
      proxyPassword = getElemValue(kProxyPassword);
    }
  }

  if ("SOCKS4" == proxyType)
  {
    settings[kTorConfKeySocks4Proxy] = proxyAddrPort;
  }
  else if ("SOCKS5" == proxyType)
  {
    settings[kTorConfKeySocks5Proxy] = proxyAddrPort;
    settings[kTorConfKeySocks5ProxyUsername] = proxyUsername;
    settings[kTorConfKeySocks5ProxyPassword] = proxyPassword;
  }
  else if ("HTTP" == proxyType)
  {
    settings[kTorConfKeyHTTPSProxy] = proxyAddrPort;
    // TODO: Does any escaping need to be done?
    settings[kTorConfKeyHTTPSProxyAuthenticator] =
                                  createColonStr(proxyUsername, proxyPassword);
  }

  return settings;
} // getAndValidateProxySettings


function isProxyConfigured()
{
  return (getWizard()) ? getYesNoRadioValue(kWizardProxyRadioGroup)
                       : getElemValue(kUseProxyCheckbox, false);
}


function reportValidationError(aStrKey)
{
  showSaveSettingsAlert(TorLauncherUtil.getLocalizedString(aStrKey));
}


// Returns true if settings were successfully applied.
function applyFirewallSettings(aUseDefaults)
{
  let settings;
  if (aUseDefaults)
    settings = getDefaultFirewallSettings();
  else if (getWizard())
    settings = getAutoFirewallSettings();
  else
    settings = getAndValidateFirewallSettings();

  if (!settings)
    return false;

  return setConfAndReportErrors(settings, null);
}


// Return a settings object if successful and null if not.
// Not used for the wizard.
function getAndValidateFirewallSettings()
{
  // TODO: validate user-entered data.  See Vidalia's NetworkPage::save()

  var settings = {};
  settings[kTorConfKeyReachableAddresses] = null;

  var allowedPorts = null;
  if (getElemValue(kUseFirewallPortsCheckbox, false))
    allowedPorts = getElemValue(kFirewallAllowedPorts, null);

  return constructFirewallSettings(allowedPorts);
}


function getDefaultFirewallSettings()
{
  return constructFirewallSettings(undefined);
}


// Return a settings object if successful and null if not.
// Only used for the wizard.
function getAutoFirewallSettings()
{
  // In the wizard, we automatically set firewall ports (ReachableAddresses) to
  // 80 and 443 if and only if the user has configured a proxy but no bridges.
  // Rationale (from ticket #11405):
  //   - Many proxies restrict which ports they will proxy for, so we want to
  //     use a small set of ports in that case.
  //
  //   - In most other situations, tor will quickly find a bridge or guard on
  //     port 443, so there is no need to limit which port may be used.
  //
  //   - People whose set of reachable ports are really esoteric will need to
  //     be very patient or they will need to edit torrc manually... but that
  //     is OK since we expect that situation to be very rare.
  var allowedPorts = null;
  if (isProxyConfigured() && !isBridgeConfigured())
    allowedPorts = "80,443";

  return constructFirewallSettings(allowedPorts);
}


function constructFirewallSettings(aAllowedPorts)
{
  var settings = {};
  settings[kTorConfKeyReachableAddresses] = null;

  if (aAllowedPorts)
  {
    var portsConfStr;
    var portsArray = aAllowedPorts.split(',');
    for (var i = 0; i < portsArray.length; ++i)
    {
      var s = portsArray[i].trim();
      if (s.length > 0)
      {
        if (!portsConfStr)
          portsConfStr = "*:" + s;
        else
          portsConfStr += ",*:" + s;
      }
    }

    if (portsConfStr)
      settings[kTorConfKeyReachableAddresses] = portsConfStr;
  }

  return settings;
}


function initDefaultBridgeTypeMenu()
{
  var menu = document.getElementById(kDefaultBridgeTypeMenuList);
  if (!menu)
    return;

  menu.removeAllItems();

  var typeArray = TorLauncherUtil.defaultBridgeTypes;
  if (!typeArray || typeArray.length == 0)
    return;

  var recommendedType = TorLauncherUtil.getCharPref(
                                      kPrefDefaultBridgeRecommendedType, null);
  var selectedType = TorLauncherUtil.getCharPref(kPrefDefaultBridgeType, null);
  if (!selectedType)
    selectedType = recommendedType;

  for (var i=0; i < typeArray.length; i++)
  {
    var bridgeType = typeArray[i];

    var menuItemLabel = bridgeType;
    if (bridgeType == recommendedType)
    {
      const key = "recommended_bridge";
      menuItemLabel += " " + TorLauncherUtil.getLocalizedString(key);
    }

    var mi = menu.appendItem(menuItemLabel, bridgeType);
    if (bridgeType == selectedType)
      menu.selectedItem = mi;
  }
}


// Returns true if settings were successfully applied.
function applyBridgeSettings(aUseDefaults)
{
  let settings = (aUseDefaults) ? getDefaultBridgeSettings()
                                : getAndValidateBridgeSettings();
  if (!settings)
    return false;

  return setConfAndReportErrors(settings, "bridgeSettings");
}


function getDefaultBridgeSettings()
{
  let settings = {};
  settings[kTorConfKeyUseBridges] = null;
  settings[kTorConfKeyBridgeList] = null;
  return settings;
}


// Return a settings object if successful and null if not.
function getAndValidateBridgeSettings()
{
  var settings = getDefaultBridgeSettings();
  var useBridges = isBridgeConfigured();
  var defaultBridgeType;
  var bridgeList;
  if (useBridges)
  {
    var useCustom = getElemValue(kCustomBridgesRadio, false);
    if (useCustom)
    {
      var bridgeStr = getElemValue(kBridgeList, null);
      bridgeList = parseAndValidateBridges(bridgeStr);
      if (!bridgeList)
      {
        reportValidationError("error_bridges_missing");
        return null;
      }

      setBridgeListElemValue(bridgeList);
    }
    else
    {
      defaultBridgeType = getElemValue(kDefaultBridgeTypeMenuList, null);
      if (!defaultBridgeType)
      {
        reportValidationError("error_default_bridges_type_missing");
        return null;
      }
    }
  }

  // Since it returns a filtered list of bridges,
  // TorLauncherUtil.defaultBridges must be called after setting the
  // kPrefDefaultBridgeType pref.
  TorLauncherUtil.setCharPref(kPrefDefaultBridgeType, defaultBridgeType);
  if (defaultBridgeType)
    bridgeList = TorLauncherUtil.defaultBridges;

  if (useBridges && bridgeList)
  {
    settings[kTorConfKeyUseBridges] = true;
    settings[kTorConfKeyBridgeList] = bridgeList;
  }

  return settings;
}


function isBridgeConfigured()
{
  return (getWizard()) ? getElemValue("bridgesRadioYes", false)
                       : getElemValue(kUseBridgesCheckbox, false);
}


// Returns an array or null.
function parseAndValidateBridges(aStr)
{
  if (!aStr)
    return null;

  var resultStr = aStr;
  resultStr = resultStr.replace(/\r\n/g, "\n");  // Convert \r\n pairs into \n.
  resultStr = resultStr.replace(/\r/g, "\n");    // Convert \r into \n.
  resultStr = resultStr.replace(/\n\n/g, "\n");  // Condense blank lines.

  var resultArray = new Array;
  var tmpArray = resultStr.split('\n');
  for (var i = 0; i < tmpArray.length; i++)
  {
    let s = tmpArray[i].trim();       // Remove extraneous white space.
    s = s.replace(/^bridge\s+/i, ""); // Remove "bridge " from start of line.
    resultArray.push(s);
  }

  return (0 == resultArray.length) ? null : resultArray;
}


// Returns true if successful.
// aShowOnErrorPanelID is only used when displaying the wizard.
function setConfAndReportErrors(aSettingsObj, aShowOnErrorPanelID)
{
  var errObj = {};
  var didSucceed = gProtocolSvc.TorSetConfWithReply(aSettingsObj, errObj);
  if (!didSucceed)
  {
    if (aShowOnErrorPanelID)
    {
      var wizardElem = getWizard();
      if (wizardElem) try
      {
        const kMaxTries = 10;
        for (var count = 0;
             ((count < kMaxTries) &&
              (wizardElem.currentPage.pageid != aShowOnErrorPanelID) &&
              wizardElem.canRewind);
             ++count)
        {
          wizardElem.rewind();
        }
      } catch (e) {}
    }

    showSaveSettingsAlert(errObj.details);
  }

  return didSucceed;
}


function showSaveSettingsAlert(aDetails)
{
  TorLauncherUtil.showSaveSettingsAlert(window, aDetails);
  showOrHideButton("extra2", true, false);
  gWizIsCopyLogBtnShowing = true;
}


function setElemValue(aID, aValue)
{
  var elem = document.getElementById(aID);
  if (elem)
  {
    var val = aValue;
    switch (elem.tagName)
    {
      case "checkbox":
        elem.checked = val;
        toggleElemUI(elem);
        break;
      case "textbox":
        if (Array.isArray(aValue))
        {
          val = "";
          for (var i = 0; i < aValue.length; ++i)
          {
            if (val.length > 0)
              val += '\n';
            val += aValue[i];
          }
        }
        // fallthru
      case "menulist":
      case "listbox":
        elem.value = (val) ? val : "";
        break;
    }
  }
}


// Returns true if one or more values were set.
function setBridgeListElemValue(aBridgeArray)
{
  // Trim white space and only keep non-empty values.
  var bridgeList = [];
  if (aBridgeArray)
  {
    for (var i = 0; i < aBridgeArray.length; ++i)
    {
      var s = aBridgeArray[i].trim();
      if (s.length > 0)
        bridgeList.push(s);
    }
  }

  setElemValue(kBridgeList, bridgeList);
  return (bridgeList.length > 0);
}


// Returns a Boolean (for checkboxes/radio buttons) or a
// string (textbox and menulist).
// Leading and trailing white space is trimmed from strings.
function getElemValue(aID, aDefaultValue)
{
  var rv = aDefaultValue;
  var elem = document.getElementById(aID);
  if (elem)
  {
    switch (elem.tagName)
    {
      case "checkbox":
        rv = elem.checked;
        break;
      case "radio":
        rv = elem.selected;
        break;
      case "textbox":
      case "menulist":
      case "listbox":
        rv = elem.value;
        break;
    }
  }

  if (rv && ("string" == (typeof rv)))
    rv = rv.trim();

  return rv;
}


// This assumes that first radio button is yes.
function setYesNoRadioValue(aGroupID, aIsYes)
{
  var elem = document.getElementById(aGroupID);
  if (elem)
    elem.selectedIndex = (aIsYes) ? 0 : 1;
}


// This assumes that first radio button is yes.
function getYesNoRadioValue(aGroupID)
{
  var elem = document.getElementById(aGroupID);
  return (elem) ? (0 == elem.selectedIndex) : false;
}


function toggleElemUI(aElem)
{
  if (!aElem)
    return;

  var gbID = aElem.getAttribute("groupboxID");
  if (gbID)
  {
    var gb = document.getElementById(gbID);
    if (gb)
      gb.hidden = !aElem.checked;
  }
}


// Separate aStr at the first colon.  Always return a two-element array.
function parseColonStr(aStr)
{
  var rv = ["", ""];
  if (!aStr)
    return rv;

  var idx = aStr.indexOf(":");
  if (idx >= 0)
  {
    if (idx > 0)
      rv[0] = aStr.substring(0, idx);
    rv[1] = aStr.substring(idx + 1);
  }
  else
  {
    rv[0] = aStr;
  }

  return rv;
}


function createColonStr(aStr1, aStr2)
{
  var rv = aStr1;
  if (aStr2)
  {
    if (!rv)
      rv = "";
    rv += ':' + aStr2;
  }

  return rv;
}
