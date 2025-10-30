# Requirements to list on Chrome Web Store

## Store Listing

This page describes how to fill out the Store listing tab in the Developer Dashboard. This is where you can add information about your item that isn't included in the metadata of the manifest, such as a long description, screenshots, a promotional video, and links to related sites.

### Product details

-  **Detailed Description**: Start your description with a concise statement of what your item does, so users can understand the main idea and features at a glance. After that provide additional details, promotional copy, update logs, and so forth. Be detailed but ensure it complies with the [Keyword spam](https://developer.chrome.com/docs/webstore/program-policies/spam-faq#keyword-spam) policy.
    - ***TO DO***
- **Primary Category**: See [this link](https://developer.chrome.com/docs/webstore/best-practices#choose-category-well).
    - ***TO DO***
- **Language**
    - ***TO DO***

### Graphic assets

Useful links: [Supplying Images](https://developer.chrome.com/docs/webstore/images), [Branding Guidelines](https://developer.chrome.com/docs/webstore/branding)

- **Store Icon**: 128x128 px
    - ***TO DO***
- **1-5 Screenshots**: 1280x800 px
    - ***TO DO***
- **Youtube Video**: Link to video that showcases extension features
    - ***TO DO***
- **Small Promo Tile**: 440x280 px PNG or JPEG file
    - ***TO DO***
- **Optional Marquee Promo Tile**: 1400x560 px PNG or JPEG file

### Locale

If our extension supports locales (e.g., different languages), this is for localizing our extension page. See [here](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#localize_your_listing).

### Additional Fields

All of the following are optional.

- **Verified Publisher Status**:
    - Doesn't apply to us, we don't have a verified publisher status to list
- **Add a homepage URL**: This site should contain information about your extension to help users learn more about your extension features or service.
- **Provide a support URL**: You can direct users to a dedicated support site
- **Declare content rating**: Content ratings help users know whether your extension and its content are mature in nature. See [Mature Content Guidelines](https://developer.chrome.com/docs/webstore/rating) to determine whether your extension should be rated "Mature."

## Privacy

Where you declare your extension's single purpose and how your extension is handling user data.

- **Single purpose description**: An extension must have a single purpose that is narrow and easy to understand. Make sure that this field clearly communicates this purpose for your extension.
    - ***TO DO***
- **Permissions justification**: Extension should request the [minimal permissions](https://developer.chrome.com/docs/extensions/mv3/security#permissions) consistent with the purpose of the extension. Each requested permission must be supplemented with a justification
    - Our requested permissions:
        - "cookies": ***TO DO***
        - "history": ***TO DO***
        - "activeTab": ***TO DO***
        - "storage": ***TO DO***
        - "downloads": ***TO DO***
        - "tabs": ***TO DO***
        - "scripting": ***TO DO***
- **Remote Code**: Remote code is any JS, Wasm, or CSS, not included in the extension package. Avoid using remote code except where absolutely necessary. It must be declared here.
    - ***TO DO***
    - We must check that we have none, as Firefox does not allow any remote code.
- **Data Usage**: Use this field to disclose and certify your data collection practices. Use the first group of checkboxes to disclose which types of data your extension collects. Use the second group of checkboxes to certify that you comply with each of the disclosure statements.
    - ***TO DO***
    - See permissions listed [here](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy#certify_your_data_use_practices).
- **Privacy Policy**: Link to the privacy policy for our extension. The policy should include how data is collected, used, and disclosed.
    - ***TO DO***
    - Necessary if we collect user data. Read more about creating a privacy policy [here](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#ques_5).

## Distribution

Declare if your extension is free or contains in-app purchases. You can also choose who will see it on the Chrome Web Store.

- **Declaring in-app purchases**:
    - N/A for us
- **Visibility**: Public vs Unlisted vs Private
    - ***TO DO***
    - If we were to set private, we can include trusted users, google groups, and/or domain publishing. Read [here](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution#setting-the-visibility).
- **Geographic Distribution**: Specify which geographic areas will see your item listing. Either all regions or individual countries.
    - ***TO DO***
- **Publishing a test version**: Testing version parallel to production version.
    - Optional, see [here](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution#publishing_a_test_version).

## Test Instructions

This is optional. Can provide credentials and instructions for CWS reviewers, allowing them to more accurately evaluate an item's quality. This is only useful if the item requires restricted credentials or a paid account for full access to all features.

See more [here](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions).