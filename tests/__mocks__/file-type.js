/**
 * Manual mock for file-type module
 * Used in unit tests to mock file type detection
 */

// Default mock implementation returns null (no file type detected)
// Individual tests can override this with mockResolvedValue()
const fromBuffer = jest.fn().mockResolvedValue(null);

const fileTypeMock = {
    fromBuffer,
    // Add other methods if needed
    fromFile: jest.fn(),
    fromStream: jest.fn(),
};

module.exports = fileTypeMock;
