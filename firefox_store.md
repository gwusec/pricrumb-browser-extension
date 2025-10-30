# Requirements to publish an add-on on Firefox

We'll need a developer firefox account. See [here](https://extensionworkshop.com/documentation/publish/developer-accounts/).

Few things to double check:
- No remote code
- Add-ons must not relax web page security headers, such as the Content Security Policy.
- Add-ons must use encryption when transporting data remotely
- Add-ons should avoid including redundant code or files.
- Only release versions of third-party libraries and/or frameworks may be included with an add-on.
- Read more [here](https://extensionworkshop.com/documentation/publish/add-on-policies/).

Process to submit found [here](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).

## Submit a New Add-on

- Summary: Clearly explains what the add-on does. ~200 characters max.
    - ***TO DO***
- Description: Longer explanation of features, functionality, and other relevant information. Recommended length: 250 chars. If longer, make sure the first 250 chars contain most key points.
- Experimental flag: Reduces visibility if add-on not ready for general use
- Select up to 2 Firefox categories
- Select up to 2 Firefox Android Categories
- Support Email & Support website: an email address and website where users can get in touch when they have questions, issues, or compliments.
- License
- Privacy Policy: if any data is being transmitted from the user’s device, a privacy policy explaining what is being sent and how it’s used is required. Check this box and provide the privacy policy.
- Notes for Reviewers: information to assist the AMO reviewer, such as log in details for a dummy account, source code information, or similar.