import Toybox.Application;
import Toybox.Cryptography;
import Toybox.Lang;

// Each watch gets its own random ID on first launch, kept in Application.Storage.
// The old shared constant ("fenix-6s-solar") was in the public source, so
// anyone could address this watch on the server by name.
(:background)
module DeviceId {

    const STORAGE_KEY = "device_id";
    // Crockford base32: no I, L, O or U, so it is easy to read off a watch and type.
    const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    // The stored ID, or null if the foreground app hasn't created one yet.
    // Safe to call from the background service.
    function get() as String? {
        var id = Application.Storage.getValue(STORAGE_KEY);
        return id instanceof String ? id : null;
    }

    // Foreground only: returns the ID, creating and storing it on first launch.
    function getOrCreate() as String {
        var id = get();
        if (id == null) {
            id = generate();
            Application.Storage.setValue(STORAGE_KEY, id);
        }
        return id;
    }

    // "SS-XXXX-XXXX-XXXX": 12 base32 characters = 60 random bits.
    function generate() as String {
        var bytes = Cryptography.randomBytes(12);
        var chars = ALPHABET.toCharArray();
        var id = "SS-";
        for (var i = 0; i < 12; i++) {
            id += chars[bytes[i] % 32].toString(); // 256 is a multiple of 32, so no bias
            if (i == 3 || i == 7) {
                id += "-";
            }
        }
        return id;
    }
}
