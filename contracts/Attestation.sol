// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Attestation {
    event Attested(bytes32 indexed reportHash, address indexed attester, uint256 ts);

    function attest(bytes32 h) external {
        emit Attested(h, msg.sender, block.timestamp);
    }
}
