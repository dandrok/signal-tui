import { describe, expect, test } from "bun:test";
import {
	buildQrPlan,
	LINK_NAME_DEFAULT,
	linkInstructions,
	parseLinkArgs,
	parseLinkLine,
	QR_UNAVAILABLE_HELP,
} from "../src/cli/linking";

describe("parseLinkLine", () => {
	test("finds the link URI printed beside the QR art", () => {
		const event = parseLinkLine("sgnl://linkdevice?uuid=abc%3D%3D&pub_key=xyz&capabilities=");
		expect(event).toEqual({
			kind: "uri",
			value: "sgnl://linkdevice?uuid=abc%3D%3D&pub_key=xyz&capabilities=",
		});
	});

	test("stops at whitespace so trailing output is not swallowed", () => {
		expect(parseLinkLine("  sgnl://linkdevice?uuid=a  extra  ")?.value).toBe(
			"sgnl://linkdevice?uuid=a",
		);
	});

	test("recognises the confirmation line", () => {
		expect(parseLinkLine("Associated with: +48123456789")).toEqual({
			kind: "linked",
			value: "+48123456789",
		});
	});

	test("ignores QR block art and progress noise", () => {
		for (const line of ["████████", "", "INFO  Waiting for scan", "??????"]) {
			expect(parseLinkLine(line)).toBeNull();
		}
	});

	test("ignores a confirmation without a number", () => {
		expect(parseLinkLine("Associated with:   ")).toBeNull();
	});
});

describe("buildQrPlan", () => {
	test("encodes the URI into a PNG at the given path", () => {
		const plan = buildQrPlan("sgnl://linkdevice?uuid=a", "/tmp/link.png");

		expect(plan.path).toBe("/tmp/link.png");
		expect(plan.argv.slice(0, 7)).toEqual(["qrencode", "-t", "PNG", "-s", "8", "-m", "2"]);
		expect(plan.argv.at(-1)).toBe("sgnl://linkdevice?uuid=a");
		expect(plan.argv).toContain("-o");
	});
});

describe("parseLinkArgs", () => {
	test("defaults the device name", () => {
		expect(parseLinkArgs([])).toBe(LINK_NAME_DEFAULT);
	});

	test("accepts --name", () => {
		expect(parseLinkArgs(["--name", "work-laptop"])).toBe("work-laptop");
	});

	test("rejects --name without a value", () => {
		expect(() => parseLinkArgs(["--name"])).toThrow();
		expect(() => parseLinkArgs(["--name", "   "])).toThrow();
	});
});

describe("help text", () => {
	test("tells the user what to install and why", () => {
		expect(QR_UNAVAILABLE_HELP).toContain("qrencode");
		expect(QR_UNAVAILABLE_HELP).toContain("pacman");
	});

	test("points at the next command after linking", () => {
		expect(linkInstructions("+48123456789")).toContain("--account +48123456789");
		expect(linkInstructions("+48123456789")).toContain("Linked devices");
	});
});
