//trcaking users activity when asked to change privacy prefrences:

      // Analytics Module
      const Analytics = {
        events: [],

        init() {
          // Check for Updates to Local Storage 
          //------> Do We need storage?
          addEventListener("storage", (event) => {
            if (event.key === "survey-data") {
              let surveyData = localStorage.getItem("survey-data");
              if (surveyData) {
                surveyData = JSON.parse(surveyData);
                if (!("labelAnalytics" in surveyData)) {
                  saveEvents();
                }
              }
            }
          });

          // Add scroll tracking 
          //------> We need it 
          let scrollTimeout;
          document.addEventListener("scroll", () => {
            if (scrollTimeout) clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
              this.trackEvent("scroll", {
                scrollY: window.scrollY,
                viewportHeight: window.innerHeight,
                pageHeight: document.documentElement.scrollHeight,
              });
            }, 150); // Debounce scroll events
          });

          // Add hover tracking
          document.addEventListener("mouseover", (e) => {
            const trackedElements = e.target.closest("[data-track]");
            if (trackedElements) {
              this.trackEvent("hover", {
                element: trackedElements.getAttribute("data-track"),
                elementType: trackedElements.tagName.toLowerCase(),
              });
            }
          });

          // Add click tracking
          document.addEventListener("click", (e) => {
            const trackedElements = e.target.closest("[data-track]");
            if (trackedElements) {
              this.trackEvent("click", {
                element: trackedElements.getAttribute("data-track"),
                elementType: trackedElements.tagName.toLowerCase(),
              });
            }
          });
        },

        trackEvent(type, data) {
          const event = {
            timestamp: new Date().toISOString(),
            type,
            data,
            sessionId: this.getSessionId(),
          };

          this.events.push(event);
          this.saveEvents();

          // For development purposes - log events to console
          console.log("Analytics Event:", event);
        },

        getSessionId() {
          let sessionId = sessionStorage.getItem("dataSafetySessionId");
          if (!sessionId) {
            sessionId = `session_${Date.now()}`;
            sessionStorage.setItem("dataSafetySessionId", sessionId);
          }
          return sessionId;
        },

        saveEvents() {
          // Check if there are existing events in localStorage
          // -------------> Mismatch between "survey-data" here and "dataSafetyAnalytics" in clearEvents()?
          let surveyData = localStorage.getItem("survey-data");
          if (surveyData) {
            surveyData = JSON.parse(surveyData);
          } else {
            surveyData = {};
          }

          if ("labelAnalytics" in surveyData && this.events.length == 0) {
            this.events = surveyData.labelAnalytics;
          }
          surveyData.labelAnalytics = this.events;

          localStorage.setItem("survey-data", JSON.stringify(surveyData));
        },

        getEvents() {
          return this.events;
        },

        clearEvents() {
          this.events = [];
          localStorage.removeItem("dataSafetyAnalytics");
        },
      };

      // Initialize analytics when the page loads
      document.addEventListener("DOMContentLoaded", () => {
        Analytics.init();

        // Track initial page load
        Analytics.trackEvent("page_load", {
          url: window.location.href,
          timestamp: new Date().toISOString(),
        });
      });
