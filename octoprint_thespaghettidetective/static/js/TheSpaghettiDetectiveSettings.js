/*
 * View model for TheSpaghettiDetective Wizard
 *
 * Author: The Spaghetti Detective
 * License: AGPLv3
 */
$(function () {

    $(function() {
        $('.tsd-collapsable-title').click(function() {
            $(this).parent().toggleClass('opened');
        })
    });

    function TheSpaghettiDetectiveSettingsViewModel(parameters) {
        var self = this;

        // assign the injected parameters, e.g.:
        // self.loginStateViewModel = parameters[0];
        self.thespaghettidetectiveWizardViewModel = parameters[0];
        self.settingsViewModel = parameters[1];
        self.wizardViewModel = parameters[2];

        self.alertsShown = {};
        self.piCamResolutionOptions = [{ id: "low", text: "Low" }, { id: "medium", text: "Medium" }, { id: "high", text: "High" }, { id: "ultra_high", text: "Ultra High" }];
        self.isWizardShown = ko.observable(
            retrieveFromLocalStorage('disableTSDWizardAutoPopupUntil', 0) > new Date().getTime()
        );
        self.showDetailPage = ko.observable(false);
        self.serverStatus = ko.mapping.fromJS({ is_connected: false, status_posted_to_server_ts: 0 });
        self.streaming = ko.mapping.fromJS({ is_pi_camera: false, premium_streaming: false, compat_streaming: false});
        self.linkedPrinter = ko.mapping.fromJS({ is_pro: false, id: null, name: null});
        self.errorStats = ko.mapping.fromJS({ server: { attempts: 0, error_count: 0, first: null, last: null }, webcam: { attempts: 0, error_count: 0, first: null, last: null }});
        self.serverTestStatusCode = ko.observable(null);
        self.serverTested = ko.observable('never');
        self.sentryOptedIn = ko.pureComputed(function () {
            return self.settingsViewModel.settings.plugins.thespaghettidetective.sentry_opt() === "in";
        }, self);
        self.configured = ko.pureComputed(function () {
            return self.settingsViewModel.settings.plugins.thespaghettidetective.auth_token
                && self.settingsViewModel.settings.plugins.thespaghettidetective.auth_token();
        }, self);
        self.wizardAutoPoppedup = ko.observable(false);
        self.disableWizardAutoPopUp = ko.observable(false);

        self.onStartupComplete = function (plugin, data) {
            self.fetchPluginStatus();
        };

        self.hasServerErrors = function() {
            return self.errorStats.server.error_count() > 0;
        };

        self.hasWebcamErrors = function() {
            return self.errorStats.webcam.error_count() > 0;
        };

        self.serverErrorRate = function() {
            return Math.round(self.errorStats.server.error_count() / self.errorStats.server.attempts() * 100);
        };

        self.webcamErrorRate = function() {
            return Math.round(self.errorStats.webcam.error_count() / self.errorStats.webcam.attempts() * 100);
        };

        self.serverTestSucceeded = function() {
            return self.serverTestStatusCode() == 200;
        };

        self.serverTestUnknownError = function() {
            return self.serverTestStatusCode() != null && self.serverTestStatusCode() != 401 && self.serverTestStatusCode() != 200;
        };

        self.fetchPluginStatus = function() {
            apiCommand({
                command: "get_plugin_status",
            })
            .done(function (data) {
                ko.mapping.fromJS(data.server_status, self.serverStatus);
                ko.mapping.fromJS(data.streaming_status, self.streaming);
                ko.mapping.fromJS(data.error_stats, self.errorStats);
                ko.mapping.fromJS(data.linked_printer, self.linkedPrinter);

                if (!self.configured() && !self.isWizardShown() && !self.wizardViewModel.isDialogActive()) {
                    self.showWizardModal();
                    self.isWizardShown(true);
                    return;
                }

                if (_.get(data, 'sentry_opt') === "out") {
                    var sentrynotice = new PNotify({
                        title: "The Spaghetti Detective",
                        text: "<p>Turn on bug reporting to help us make TSD plugin better?</p><p>The debugging info included in the report will be anonymized.</p>",
                        hide: false,
                        destroy: true,
                        confirm: {
                            confirm: true,
                        },
                    });
                    sentrynotice.get().on('pnotify.confirm', function () {
                        self.toggleSentryOpt();
                    });
                }
                _.get(data, 'alerts', []).forEach(function (alertMsg) {
                    self.displayAlert(alertMsg);
                })
            });
        };

        self.testServerConnection = function() {
            self.serverTested('testing');
            apiCommand({
                command: "test_server_connection",
            })
            .done(function (data) {
                self.serverTested('tested');
                self.serverTestStatusCode(data.status_code);
            });
        };

        self.toggleSentryOpt = function (ev) {
            apiCommand({
                command: "toggle_sentry_opt",
            });
            return true;
        };

        self.resetEndpointPrefix = function () {
            self.settingsViewModel.settings.plugins.thespaghettidetective.endpoint_prefix("https://app.thespaghettidetective.com");
        };

        self.selectPage = function(page) {
            self.showDetailPage(true);

            switch (page) {
                case 'troubleshooting':
                    $('li[data-page="advanced"]').removeClass('active');
                    $('#tsd-advanced').removeClass('active');
                    $('li[data-page="troubleshooting"]').addClass('active');
                    $('#tsd-troubleshooting').addClass('active');
                    break;
                case 'advanced':
                    $('li[data-page="troubleshooting"]').removeClass('active');
                    $('#tsd-troubleshooting').removeClass('active');
                    $('li[data-page="advanced"]').addClass('active');
                    $('#tsd-advanced').addClass('active');
                    break;
            }
        };

        self.returnToSelection = function() {
            self.showDetailPage(false);
        }

        /*** Plugin error alerts */

        self.onDataUpdaterPluginMessage = function (plugin, data) {
            if (plugin != "thespaghettidetective") {
                return;
            }

            if (data.plugin_updated) {
                self.fetchPluginStatus();
            }

            if (data.printer_autolinked) {
                self.fetchPluginStatus();
                self.thespaghettidetectiveWizardViewModel.toStep(5);
                self.thespaghettidetectiveWizardViewModel.startAutoCloseTimout();
            }
        }

        self.displayAlert = function (alertMsg) {
            var ignoredItemPath = "ignored." + alertMsg.cause + "." + alertMsg.level;
            if (retrieveFromLocalStorage(ignoredItemPath, false)) {
                return;
            }

            var showItemPath = alertMsg.cause + "." + alertMsg.level;
            if (_.get(self.alertsShown, showItemPath, false)) {
                return;
            }
            _.set(self.alertsShown, showItemPath, true);

            var text = null;
            var msgType = "error";
            if (alertMsg.level === "warning") {
                msgType = "notice";
            }

            var buttons = [
                {
                    text: "Never show again",
                    click: function (notice) {
                        saveToLocalStorage(ignoredItemPath, true);
                        notice.remove();
                    },
                    addClass: "never_button"
                },
                {
                    text: "OK",
                    click: function (notice) {
                        notice.remove();
                    },
                    addClass: "ok_button"
                },
                {
                    text: "Close",
                    addClass: "remove_button"
                },
            ];

            var hiddenButtons = ["remove_button", ];

            if (alertMsg.level === "error") {
                buttons.unshift(
                    {
                        text: "Details",
                        click: function (notice) {
                            self.showDiagnosticReportModal();
                            notice.remove();
                        }
                    }
                );
                if (alertMsg.cause === "server") {
                    text =
                        "The Spaghetti Detective failed to connect to the server. Please make sure OctoPrint has a reliable internet connection.";
                } else if (alertMsg.cause === "webcam") {
                    text =
                        'The Spaghetti Detective plugin failed to connect to the webcam. Please go to "Settings" -> "Webcam & Timelapse" and make sure the stream URL and snapshot URL are set correctly. Or follow <a href="https://www.thespaghettidetective.com/docs/warnings/webcam-connection-error-popup/">this troubleshooting guide</a>.';
                }
            }
            if (alertMsg.level === "warning") {
                if (alertMsg.cause === 'streaming') {
                    text =
                        '<p>The Premium Webcam Streaming failed to start. The Spaghetti Detective has switched to the Basic Streaming.</p><p><a href="https://www.thespaghettidetective.com/docs/warnings/webcam-switched-to-basic-streaming/">Learn more >>></a></p>';
                }
                if (alertMsg.cause === 'cpu') {
                    text =
                        '<p>The Premium Webcam Streaming uses excessive CPU. This may negatively impact your print quality. Consider switching "compatibility mode" to "auto" or "never", or disable the Premium Streaming. <a href="https://www.thespaghettidetective.com/docs/warnings/compatibility-mode-excessive-cpu/">Learn more >>></a></p>';
                }
                if (alertMsg.cause === 'octolapse_compat_mode') {
                    text =
                        '<p>Octolapse plugin detected! The Spaghetti Detective has switched to "Premium (compability)" streaming mode.</p>';
                }
                if (alertMsg.cause === "restart_required") {
                    text = '<p></p><p>A restart is needed for changes to take effect.</p>';
                    hiddenButtons.push("never_button");
                }
            }

            if (text) {
                new PNotify({
                    title: "The Spaghetti Detective",
                    text: text,
                    type: msgType,
                    hide: false,
                    confirm: {
                        confirm: true,
                        buttons: buttons,
                    },
                    history: {
                        history: false
                    },
                    before_open: function (notice) {
                        hiddenButtons.forEach(function(className) {
                            notice
                                .get()
                                .find("." + className)
                                .remove();
                        });
                    }
                });
            }
        };

        self.showDiagnosticReportModal = function () {
            $('#diagnosticReportModal').modal();
        };

        self.showWizardModal = function (maybeViewModel) {
            self.wizardAutoPoppedup(!Boolean(maybeViewModel)); // When it's triggered by user click, maybeViewModel is not undefined
            $('#wizardModal').modal({backdrop: 'static', keyboard: false});
        };

        $('#wizardModal').on('shown', function(){
            self.thespaghettidetectiveWizardViewModel.reset();
        });
        $('#wizardModal').on('hidden', function(){
            if (self.disableWizardAutoPopUp()) {
                saveToLocalStorage('disableTSDWizardAutoPopupUntil', (new Date()).getTime() + 1000*60*60*24*30); // Not show for 30 days
            }
        });
    }


    // Helper methods
    function apiCommand(data) {
        return $.ajax("api/plugin/thespaghettidetective", {
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify(data)
        });
    }

    var LOCAL_STORAGE_KEY = 'plugin.tsd';

    function localStorageObject() {
        var retrievedObject = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!retrievedObject) {
            retrievedObject = '{}';
        }
        return JSON.parse(retrievedObject);
    }

    function retrieveFromLocalStorage(itemPath, defaultValue) {
        return _.get(localStorageObject(), itemPath, defaultValue);
    }

    function saveToLocalStorage(itemPath, value) {
        var retrievedObject = localStorageObject();
        _.set(retrievedObject, itemPath, value);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(retrievedObject));
    }


    /* view model class, parameters for constructor, container to bind to
     * Please see http://docs.octoprint.org/en/master/plugins/viewmodels.html#registering-custom-viewmodels for more details
     * and a full list of the available options.
     */
    OCTOPRINT_VIEWMODELS.push({
        construct: TheSpaghettiDetectiveSettingsViewModel,
        // ViewModels your plugin depends on, e.g. loginStateViewModel, settingsViewModel, ...
        dependencies: ["thespaghettidetectiveWizardViewModel", "settingsViewModel", "wizardViewModel"],
        // Elements to bind to, e.g. #settings_plugin_thespaghettidetective, #tab_plugin_thespaghettidetective, ...
        elements: [
            "#settings_plugin_thespaghettidetective",
        ]
    });

});
