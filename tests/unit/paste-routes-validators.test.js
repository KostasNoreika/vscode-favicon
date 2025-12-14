/**
 * Unit tests for file content validators in paste-routes.js
 *
 * Tests verify:
 * - validateTextFile() accepts text files without magic byte validation
 * - validateImageFile() validates images with strict magic byte matching
 * - validateBinaryFile() validates documents/archives with Office format support
 * - validateFileContent() routes to correct validator based on MIME type
 *
 * REF-016: Tests for refactored type-specific validators
 */

// Mock file-type library BEFORE importing the module under test
jest.mock('file-type');

const fileType = require('file-type');
const {
    validateTextFile,
    validateImageFile,
    validateBinaryFile,
    validateFileContent,
} = require('../../lib/routes/paste-routes');

describe('File Content Validators', () => {
    beforeEach(() => {
        // Reset the mock before each test
        fileType.fromBuffer.mockReset();
    });

    afterEach(() => {
        fileType.fromBuffer.mockClear();
    });

    describe('validateTextFile()', () => {
        it('should accept text/plain without magic byte validation', async () => {
            const buffer = Buffer.from('Hello, world!');
            const result = await validateTextFile(buffer, 'text/plain');

            expect(result).toEqual({
                valid: true,
                detectedType: 'text/plain',
            });
            // Should not call fileType.fromBuffer for text files
            expect(fileType.fromBuffer).not.toHaveBeenCalled();
        });

        it('should accept text/markdown without magic byte validation', async () => {
            const buffer = Buffer.from('# Markdown Header');
            const result = await validateTextFile(buffer, 'text/markdown');

            expect(result).toEqual({
                valid: true,
                detectedType: 'text/markdown',
            });
            expect(fileType.fromBuffer).not.toHaveBeenCalled();
        });

        it('should accept text/csv without magic byte validation', async () => {
            const buffer = Buffer.from('name,age,city\nJohn,30,NYC');
            const result = await validateTextFile(buffer, 'text/csv');

            expect(result).toEqual({
                valid: true,
                detectedType: 'text/csv',
            });
            expect(fileType.fromBuffer).not.toHaveBeenCalled();
        });

        it('should accept application/json without magic byte validation', async () => {
            const buffer = Buffer.from('{"key": "value"}');
            const result = await validateTextFile(buffer, 'application/json');

            expect(result).toEqual({
                valid: true,
                detectedType: 'application/json',
            });
            expect(fileType.fromBuffer).not.toHaveBeenCalled();
        });

        it('should accept empty text file', async () => {
            const buffer = Buffer.from('');
            const result = await validateTextFile(buffer, 'text/plain');

            expect(result).toEqual({
                valid: true,
                detectedType: 'text/plain',
            });
            expect(fileType.fromBuffer).not.toHaveBeenCalled();
        });
    });

    describe('validateImageFile()', () => {
        it('should accept valid PNG with matching magic bytes', async () => {
            const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'image/png',
                ext: 'png',
            });

            const result = await validateImageFile(buffer, 'image/png');

            expect(result).toEqual({
                valid: true,
                detectedType: 'image/png',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should accept valid JPEG with matching magic bytes', async () => {
            const buffer = Buffer.from([0xff, 0xd8, 0xff]); // JPEG magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'image/jpeg',
                ext: 'jpg',
            });

            const result = await validateImageFile(buffer, 'image/jpeg');

            expect(result).toEqual({
                valid: true,
                detectedType: 'image/jpeg',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should accept valid WebP with matching magic bytes', async () => {
            const buffer = Buffer.from([0x52, 0x49, 0x46, 0x46]); // WebP magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'image/webp',
                ext: 'webp',
            });

            const result = await validateImageFile(buffer, 'image/webp');

            expect(result).toEqual({
                valid: true,
                detectedType: 'image/webp',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should accept valid GIF with matching magic bytes', async () => {
            const buffer = Buffer.from([0x47, 0x49, 0x46, 0x38]); // GIF magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'image/gif',
                ext: 'gif',
            });

            const result = await validateImageFile(buffer, 'image/gif');

            expect(result).toEqual({
                valid: true,
                detectedType: 'image/gif',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should reject image with no detectable magic bytes', async () => {
            const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
            fileType.fromBuffer.mockResolvedValue(null);

            const result = await validateImageFile(buffer, 'image/png');

            expect(result).toEqual({
                valid: false,
                detectedType: null,
                error: 'Invalid file - unable to verify file type',
            });
        });

        it('should reject image with mismatched MIME type', async () => {
            const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'image/png',
                ext: 'png',
            });

            const result = await validateImageFile(buffer, 'image/jpeg');

            expect(result).toEqual({
                valid: false,
                detectedType: 'image/png',
                error: 'File content does not match declared type',
            });
        });

        it('should reject image detected as non-allowed type', async () => {
            const buffer = Buffer.from([0x42, 0x4d]); // BMP magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'image/bmp',
                ext: 'bmp',
            });

            const result = await validateImageFile(buffer, 'image/png');

            expect(result).toEqual({
                valid: false,
                detectedType: 'image/bmp',
                error: 'File content does not match allowed types',
            });
        });

        it('should handle fileType library errors gracefully', async () => {
            const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
            fileType.fromBuffer.mockRejectedValue(new Error('Library error'));

            const result = await validateImageFile(buffer, 'image/png');

            expect(result).toEqual({
                valid: false,
                error: 'File validation failed',
            });
        });
    });

    describe('validateBinaryFile()', () => {
        it('should accept valid PDF with matching magic bytes', async () => {
            const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46]); // PDF magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'application/pdf',
                ext: 'pdf',
            });

            const result = await validateBinaryFile(buffer, 'application/pdf');

            expect(result).toEqual({
                valid: true,
                detectedType: 'application/pdf',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should accept valid ZIP with matching magic bytes', async () => {
            const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'application/zip',
                ext: 'zip',
            });

            const result = await validateBinaryFile(buffer, 'application/zip');

            expect(result).toEqual({
                valid: true,
                detectedType: 'application/zip',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should accept DOCX detected as ZIP (Office XML format)', async () => {
            const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'application/zip',
                ext: 'zip',
            });

            const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            const result = await validateBinaryFile(buffer, mimeType);

            expect(result).toEqual({
                valid: true,
                detectedType: mimeType, // Should return declared type, not ZIP
            });
        });

        it('should accept XLSX detected as ZIP (Office XML format)', async () => {
            const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'application/zip',
                ext: 'zip',
            });

            const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            const result = await validateBinaryFile(buffer, mimeType);

            expect(result).toEqual({
                valid: true,
                detectedType: mimeType, // Should return declared type, not ZIP
            });
        });

        it('should accept PPTX detected as ZIP (Office XML format)', async () => {
            const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'application/zip',
                ext: 'zip',
            });

            const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
            const result = await validateBinaryFile(buffer, mimeType);

            expect(result).toEqual({
                valid: true,
                detectedType: mimeType, // Should return declared type, not ZIP
            });
        });

        it('should reject binary file with no detectable magic bytes', async () => {
            const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
            fileType.fromBuffer.mockResolvedValue(null);

            const result = await validateBinaryFile(buffer, 'application/pdf');

            expect(result).toEqual({
                valid: false,
                detectedType: null,
                error: 'Invalid file - unable to verify file type',
            });
        });

        it('should reject binary file with mismatched MIME type', async () => {
            const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46]); // PDF magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'application/pdf',
                ext: 'pdf',
            });

            const result = await validateBinaryFile(buffer, 'application/zip');

            expect(result).toEqual({
                valid: false,
                detectedType: 'application/pdf',
                error: 'File content does not match declared type',
            });
        });

        it('should reject binary file detected as non-allowed type', async () => {
            const buffer = Buffer.from([0x1f, 0x8b]); // GZIP magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'application/gzip',
                ext: 'gz',
            });

            const result = await validateBinaryFile(buffer, 'application/pdf');

            expect(result).toEqual({
                valid: false,
                detectedType: 'application/gzip',
                error: 'File content does not match allowed types',
            });
        });

        it('should NOT accept ZIP when DOCX is declared and detected as non-ZIP', async () => {
            const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46]); // PDF magic bytes
            fileType.fromBuffer.mockResolvedValue({
                mime: 'application/pdf',
                ext: 'pdf',
            });

            const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            const result = await validateBinaryFile(buffer, mimeType);

            expect(result).toEqual({
                valid: false,
                detectedType: 'application/pdf',
                error: 'File content does not match declared type',
            });
        });

        it('should handle fileType library errors gracefully', async () => {
            const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46]);
            fileType.fromBuffer.mockRejectedValue(new Error('Library error'));

            const result = await validateBinaryFile(buffer, 'application/pdf');

            expect(result).toEqual({
                valid: false,
                error: 'File validation failed',
            });
        });
    });

    describe('validateFileContent() - Routing Logic', () => {

        it('should route text/plain to validateTextFile', async () => {
            const buffer = Buffer.from('Text content');
            const result = await validateFileContent(buffer, 'text/plain');

            expect(result).toEqual({
                valid: true,
                detectedType: 'text/plain',
            });
            expect(fileType.fromBuffer).not.toHaveBeenCalled();
        });

        it('should route text/markdown to validateTextFile', async () => {
            const buffer = Buffer.from('# Markdown');
            const result = await validateFileContent(buffer, 'text/markdown');

            expect(result).toEqual({
                valid: true,
                detectedType: 'text/markdown',
            });
            expect(fileType.fromBuffer).not.toHaveBeenCalled();
        });

        it('should route text/csv to validateTextFile', async () => {
            const buffer = Buffer.from('a,b,c');
            const result = await validateFileContent(buffer, 'text/csv');

            expect(result).toEqual({
                valid: true,
                detectedType: 'text/csv',
            });
            expect(fileType.fromBuffer).not.toHaveBeenCalled();
        });

        it('should route application/json to validateTextFile', async () => {
            const buffer = Buffer.from('{}');
            const result = await validateFileContent(buffer, 'application/json');

            expect(result).toEqual({
                valid: true,
                detectedType: 'application/json',
            });
            expect(fileType.fromBuffer).not.toHaveBeenCalled();
        });

        it('should route image/png to validateImageFile', async () => {
            const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
            fileType.fromBuffer.mockResolvedValue({
                mime: 'image/png',
                ext: 'png',
            });

            const result = await validateFileContent(buffer, 'image/png');

            expect(result).toEqual({
                valid: true,
                detectedType: 'image/png',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should route image/jpeg to validateImageFile', async () => {
            const buffer = Buffer.from([0xff, 0xd8, 0xff]);
            fileType.fromBuffer.mockResolvedValue({
                mime: 'image/jpeg',
                ext: 'jpg',
            });

            const result = await validateFileContent(buffer, 'image/jpeg');

            expect(result).toEqual({
                valid: true,
                detectedType: 'image/jpeg',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should route image/webp to validateImageFile', async () => {
            const buffer = Buffer.from([0x52, 0x49, 0x46, 0x46]);
            fileType.fromBuffer.mockResolvedValue({
                mime: 'image/webp',
                ext: 'webp',
            });

            const result = await validateFileContent(buffer, 'image/webp');

            expect(result).toEqual({
                valid: true,
                detectedType: 'image/webp',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should route image/gif to validateImageFile', async () => {
            const buffer = Buffer.from([0x47, 0x49, 0x46, 0x38]);
            fileType.fromBuffer.mockResolvedValue({
                mime: 'image/gif',
                ext: 'gif',
            });

            const result = await validateFileContent(buffer, 'image/gif');

            expect(result).toEqual({
                valid: true,
                detectedType: 'image/gif',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should route application/pdf to validateBinaryFile', async () => {
            const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46]);
            fileType.fromBuffer.mockResolvedValue({
                mime: 'application/pdf',
                ext: 'pdf',
            });

            const result = await validateFileContent(buffer, 'application/pdf');

            expect(result).toEqual({
                valid: true,
                detectedType: 'application/pdf',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should route application/zip to validateBinaryFile', async () => {
            const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
            fileType.fromBuffer.mockResolvedValue({
                mime: 'application/zip',
                ext: 'zip',
            });

            const result = await validateFileContent(buffer, 'application/zip');

            expect(result).toEqual({
                valid: true,
                detectedType: 'application/zip',
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should route DOCX to validateBinaryFile', async () => {
            const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
            fileType.fromBuffer.mockResolvedValue({
                mime: 'application/zip',
                ext: 'zip',
            });

            const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            const result = await validateFileContent(buffer, mimeType);

            expect(result).toEqual({
                valid: true,
                detectedType: mimeType,
            });
            expect(fileType.fromBuffer).toHaveBeenCalledWith(buffer);
        });

        it('should handle unknown MIME type gracefully', async () => {
            const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);

            // This should never happen because multer validates MIME type first
            // but we test defensive behavior
            const result = await validateFileContent(buffer, 'application/unknown');

            expect(result).toEqual({
                valid: false,
                detectedType: null,
                error: 'File validation failed',
            });
            expect(fileType.fromBuffer).not.toHaveBeenCalled();
        });
    });

    describe('validateFileContent() - Integration Tests', () => {
        it('should correctly validate all allowed image types', async () => {
            const imageTypes = [
                { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
                { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
                { mime: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] },
                { mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
            ];

            for (const imageType of imageTypes) {
                const buffer = Buffer.from(imageType.magic);
                fileType.fromBuffer.mockResolvedValue({
                    mime: imageType.mime,
                    ext: imageType.mime.split('/')[1],
                });

                const result = await validateFileContent(buffer, imageType.mime);

                expect(result).toEqual({
                    valid: true,
                    detectedType: imageType.mime,
                });

                fileType.fromBuffer.mockReset();
            }
        });

        it('should correctly validate all allowed text types', async () => {
            const textTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];

            for (const textType of textTypes) {
                const buffer = Buffer.from('Sample content');
                const result = await validateFileContent(buffer, textType);

                expect(result).toEqual({
                    valid: true,
                    detectedType: textType,
                });
                expect(fileType.fromBuffer).not.toHaveBeenCalled();

                fileType.fromBuffer.mockReset();
            }
        });

        it('should correctly validate Office XML formats', async () => {
            const officeTypes = [
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            ];

            for (const officeType of officeTypes) {
                const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP magic
                fileType.fromBuffer.mockResolvedValue({
                    mime: 'application/zip',
                    ext: 'zip',
                });

                const result = await validateFileContent(buffer, officeType);

                expect(result).toEqual({
                    valid: true,
                    detectedType: officeType, // Should return declared type, not ZIP
                });

                fileType.fromBuffer.mockReset();
            }
        });
    });
});
